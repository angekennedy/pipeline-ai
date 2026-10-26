-- 0008 restrictions par plan (tâche 3.6) : durée maximale, palier Premium, nombre de presets de
-- chaîne, abonnement impayé. Seconde couche, après la vérification de la Server Action : la RPC de
-- création et un trigger sur `channels` refusent ce que le plan n'autorise pas.

-- Le plan d'un workspace ne change que par le service role (webhooks Stripe, tâche 3.4). La policy
-- ws_admin laissait un admin réécrire toute la ligne, plan_key et stripe_customer_id compris :
-- l'UPDATE client est limité au nom et au slug.
revoke update on public.workspaces from authenticated;
grant update (name, slug) on public.workspaces to authenticated;

-- Limites de chaque plan. Miroir de PLANS (src/lib/billing/plans.ts), dont un test d'intégration
-- vérifie la parité. Un plan inconnu reçoit les limites de Free, les plus restrictives.
create or replace function private.plan_limits(p_plan text)
returns table (max_duration_minutes int, premium boolean, channel_presets int)
language sql
immutable
set search_path = ''
as $$
  with l (plan_key, max_duration_minutes, premium, channel_presets) as (values
    ('free', 10, false, 1),
    ('creator', 60, false, 3),
    ('pro', 60, false, 10),
    ('studio', 60, true, 50)
  )
  select l.max_duration_minutes, l.premium, l.channel_presets from l
  where l.plan_key = case when exists (select 1 from l where l.plan_key = p_plan) then p_plan else 'free' end
$$;

-- Impayé : les nouveaux pipelines sont bloqués, la lecture est conservée (ARCHITECTURE §5.3).
create or replace function private.subscription_past_due(p_workspace uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.workspace_id = p_workspace and s.status in ('past_due', 'unpaid')
  )
$$;

revoke all on function private.plan_limits, private.subscription_past_due from public, anon, authenticated;

-- Création du pipeline (0006), avec les restrictions du plan avant toute écriture. Une clé déjà
-- utilisée renvoie toujours son pipeline, même si le plan a changé depuis : c'est une relecture.
-- Refus : PLAN_RESTRICTED (42501), détail JSON {reason, plan, limit?}, où reason vaut
-- `subscription_past_due`, `duration` ou `premium`.
create or replace function public.create_pipeline_with_reservation(
  p_workspace uuid, p_user uuid, p_brief jsonb, p_tier text, p_credits int, p_key text,
  p_channel uuid default null, p_channel_snapshot jsonb default null
)
returns table (pipeline_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  new_id uuid;
  plan text;
  limits record;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace and m.user_id = p_user and m.role >= 'editor'
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query select p.id, false from public.pipelines p where p.workspace_id = p_workspace and p.idempotency_key = p_key;
  if found then return; end if;

  select w.plan_key into plan from public.workspaces w where w.id = p_workspace;
  select * into limits from private.plan_limits(plan);
  if private.subscription_past_due(p_workspace) then
    raise exception 'PLAN_RESTRICTED' using errcode = '42501',
      detail = json_build_object('reason', 'subscription_past_due', 'plan', plan)::text;
  end if;
  if (p_brief ->> 'durationMinutes')::int > limits.max_duration_minutes then
    raise exception 'PLAN_RESTRICTED' using errcode = '42501',
      detail = json_build_object('reason', 'duration', 'plan', plan, 'limit', limits.max_duration_minutes)::text;
  end if;
  if p_tier = 'premium' and not limits.premium then
    raise exception 'PLAN_RESTRICTED' using errcode = '42501',
      detail = json_build_object('reason', 'premium', 'plan', plan)::text;
  end if;

  if p_channel is not null and not exists (
    select 1 from public.channels c where c.id = p_channel and c.workspace_id = p_workspace
  ) then
    raise exception 'CHANNEL_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_credits <= 0 then raise exception 'INVALID_CREDITS' using errcode = '22023'; end if;

  -- Deux appels simultanés avec la même clé : le second attend la fin du premier sur l'index unique,
  -- puis ne fait rien s'il a réussi.
  insert into public.pipelines (workspace_id, channel_id, created_by, brief, channel_snapshot, model_tier, idempotency_key, credits_reserved)
  values (p_workspace, p_channel, p_user, p_brief, p_channel_snapshot, p_tier, p_key, p_credits)
  on conflict (workspace_id, idempotency_key) do nothing
  returning id into new_id;

  if new_id is null then
    return query select p.id, false from public.pipelines p where p.workspace_id = p_workspace and p.idempotency_key = p_key;
    return;
  end if;

  perform private.credit_op(p_workspace, 'reserve', p_credits, 'reserve:pipe:' || new_id, new_id);
  insert into public.pipeline_assets (pipeline_id, workspace_id, type)
  select new_id, p_workspace, t from unnest(enum_range(null::public.asset_type)) as t;
  return query select new_id, true;
end
$$;

revoke all on function public.create_pipeline_with_reservation from public, anon, authenticated;
grant execute on function public.create_pipeline_with_reservation to service_role;

-- Presets de chaîne : les membres les créent directement (policy ch_write), la limite est donc
-- posée en base. Le verrou sur la ligne du workspace sérialise deux créations simultanées, qui
-- liraient sinon le même compte.
create or replace function private.enforce_channel_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan text;
  max_presets int;
begin
  -- Le trigger passe avant la RLS : un non-éditeur est laissé à son refus (ch_write), sans lire le
  -- plan d'un autre workspace ni verrouiller sa ligne. En service role, auth.uid() est vide.
  if auth.uid() is not null and not private.has_role(new.workspace_id, 'editor') then
    return new;
  end if;
  select w.plan_key into plan from public.workspaces w where w.id = new.workspace_id for update;
  select l.channel_presets into max_presets from private.plan_limits(plan) l;
  if (select count(*) from public.channels c where c.workspace_id = new.workspace_id) >= max_presets then
    raise exception 'PLAN_RESTRICTED' using errcode = '42501',
      detail = json_build_object('reason', 'channel_presets', 'plan', plan, 'limit', max_presets)::text;
  end if;
  return new;
end
$$;
revoke all on function private.enforce_channel_limit from public, anon, authenticated;

create trigger channels_plan_limit
  before insert on public.channels
  for each row execute function private.enforce_channel_limit();
