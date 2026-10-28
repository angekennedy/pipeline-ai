-- 0018 workspaces internes : ceux de l'exploitant, pour tester sans limite. Toutes les fonctionnalités
-- (Premium, 60 min, vidéo) quel que soit le plan, et des crédits ajoutés à la demande : chaque
-- complément est un `grant` du journal, les coûts réels restent mesurés. Seul le service role pose
-- le drapeau (page /admin, réservée à ADMIN_EMAILS) ; le client ne peut pas l'écrire (0008 limite
-- l'UPDATE des workspaces au nom et au slug).

alter table public.workspaces add column is_internal boolean not null default false;

-- Complète le solde disponible d'un workspace interne pour couvrir `p_amount`. Sans effet pour un
-- autre workspace, ou quand le solde suffit. Idempotent par clé.
create or replace function private.ensure_internal_credits(p_workspace uuid, p_amount int, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  available int;
begin
  if not exists (select 1 from public.workspaces w where w.id = p_workspace and w.is_internal) then return; end if;
  select a.balance - a.reserved into available from public.credit_accounts a where a.workspace_id = p_workspace;
  if coalesce(available, 0) < p_amount then
    perform private.credit_op(p_workspace, 'grant', p_amount - coalesce(available, 0), 'grant:internal:' || p_key, null, null, '{"reason": "internal"}');
  end if;
end
$$;

revoke all on function private.ensure_internal_credits from public, anon, authenticated;

-- Création du pipeline (0017) : un workspace interne passe les restrictions du plan, et reçoit les
-- crédits qui manquent avant la réservation.
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
  internal boolean;
  limits record;
  wants_video boolean := coalesce((p_brief ->> 'video')::boolean, false);
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace and m.user_id = p_user and m.role >= 'editor'
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query select p.id, false from public.pipelines p where p.workspace_id = p_workspace and p.idempotency_key = p_key;
  if found then return; end if;

  select w.plan_key, w.is_internal into plan, internal from public.workspaces w where w.id = p_workspace;
  if not internal then
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
    if wants_video and not private.plan_allows_video(plan) then
      raise exception 'PLAN_RESTRICTED' using errcode = '42501',
        detail = json_build_object('reason', 'video', 'plan', plan)::text;
    end if;
  end if;

  if p_channel is not null and not exists (
    select 1 from public.channels c where c.id = p_channel and c.workspace_id = p_workspace
  ) then
    raise exception 'CHANNEL_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_credits <= 0 then raise exception 'INVALID_CREDITS' using errcode = '22023'; end if;

  insert into public.pipelines (workspace_id, channel_id, created_by, brief, channel_snapshot, model_tier, idempotency_key, credits_reserved)
  values (p_workspace, p_channel, p_user, p_brief, p_channel_snapshot, p_tier, p_key, p_credits)
  on conflict (workspace_id, idempotency_key) do nothing
  returning id into new_id;

  if new_id is null then
    return query select p.id, false from public.pipelines p where p.workspace_id = p_workspace and p.idempotency_key = p_key;
    return;
  end if;

  perform private.ensure_internal_credits(p_workspace, p_credits, 'pipe:' || new_id);
  perform private.credit_op(p_workspace, 'reserve', p_credits, 'reserve:pipe:' || new_id, new_id);
  insert into public.pipeline_assets (pipeline_id, workspace_id, type)
  select new_id, p_workspace, t from unnest(enum_range(null::public.asset_type)) as t
  where t <> 'video' or wants_video;
  return query select new_id, true;
end
$$;

revoke all on function public.create_pipeline_with_reservation from public, anon, authenticated;
grant execute on function public.create_pipeline_with_reservation to service_role;

-- Régénération (0012) : même traitement pour un workspace interne.
create or replace function public.reserve_regeneration(
  p_workspace uuid, p_user uuid, p_pipeline uuid, p_key text, p_credits int, p_tier text
)
returns boolean -- true : réservée maintenant ; false : déjà réservée avec cette clé
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan text;
  internal boolean;
  limits record;
begin
  if p_key !~ '^regen:[\w-]{8,64}$' then raise exception 'INVALID_KEY' using errcode = '22023'; end if;
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace and m.user_id = p_user and m.role >= 'editor'
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  -- Verrou du pipeline d'abord, comme la capture et la finalisation.
  perform 1 from public.pipelines p where p.id = p_pipeline and p.workspace_id = p_workspace for update;
  if not found then raise exception 'PIPELINE_NOT_FOUND' using errcode = 'P0002'; end if;
  if exists (select 1 from public.credit_ledger l where l.idempotency_key = 'reserve:' || p_key) then return false; end if;

  select w.plan_key, w.is_internal into plan, internal from public.workspaces w where w.id = p_workspace;
  if not internal then
    select * into limits from private.plan_limits(plan);
    if private.subscription_past_due(p_workspace) then
      raise exception 'PLAN_RESTRICTED' using errcode = '42501',
        detail = json_build_object('reason', 'subscription_past_due', 'plan', plan)::text;
    end if;
    if p_tier = 'premium' and not limits.premium then
      raise exception 'PLAN_RESTRICTED' using errcode = '42501',
        detail = json_build_object('reason', 'premium', 'plan', plan)::text;
    end if;
  end if;
  if p_credits <= 0 then raise exception 'INVALID_CREDITS' using errcode = '22023'; end if;

  perform private.ensure_internal_credits(p_workspace, p_credits, p_key);
  perform private.credit_op(p_workspace, 'reserve', p_credits, 'reserve:' || p_key, p_pipeline);
  return true;
end
$$;

revoke all on function public.reserve_regeneration from public, anon, authenticated;
grant execute on function public.reserve_regeneration to service_role;

-- Pose ou retire le drapeau (page /admin). Renvoie false si le workspace n'existe pas.
create or replace function public.set_workspace_internal(p_workspace uuid, p_internal boolean)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with updated as (update public.workspaces set is_internal = p_internal where id = p_workspace returning 1)
  select exists (select 1 from updated)
$$;

revoke all on function public.set_workspace_internal from public, anon, authenticated;
grant execute on function public.set_workspace_internal to service_role;

-- Presets de chaîne (0008) : pas de limite pour un workspace interne.
create or replace function private.enforce_channel_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan text;
  internal boolean;
  max_presets int;
begin
  -- Le trigger passe avant la RLS : un non-éditeur est laissé à son refus (ch_write), sans lire le
  -- plan d'un autre workspace ni verrouiller sa ligne. En service role, auth.uid() est vide.
  if auth.uid() is not null and not private.has_role(new.workspace_id, 'editor') then
    return new;
  end if;
  select w.plan_key, w.is_internal into plan, internal from public.workspaces w where w.id = new.workspace_id for update;
  if internal then return new; end if;
  select l.channel_presets into max_presets from private.plan_limits(plan) l;
  if (select count(*) from public.channels c where c.workspace_id = new.workspace_id) >= max_presets then
    raise exception 'PLAN_RESTRICTED' using errcode = '42501',
      detail = json_build_object('reason', 'channel_presets', 'plan', plan, 'limit', max_presets)::text;
  end if;
  return new;
end
$$;
revoke all on function private.enforce_channel_limit from public, anon, authenticated;
