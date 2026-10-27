-- 0017 vidéo complète : option du brief (`brief.video`), réservée aux plans payants, bail prolongé
-- pendant un rendu long, stockage des médias (images, voix off, sous-titres).

-- Plans qui autorisent la vidéo. Miroir de PLANS.video (src/lib/billing/plans.ts). Un plan inconnu
-- reçoit les droits de Free.
create or replace function private.plan_allows_video(p_plan text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_plan in ('creator', 'pro', 'studio'), false)
$$;

revoke all on function private.plan_allows_video from public, anon, authenticated;

-- Création du pipeline (0008) : même contrôle, plus la vidéo. L'asset `video` n'est créé que si le
-- brief la demande, pour qu'un pipeline sans vidéo n'ait pas d'asset en attente pour toujours.
-- Refus : PLAN_RESTRICTED (42501), reason `video` en plus de `subscription_past_due`, `duration`
-- et `premium`.
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
  if wants_video and not private.plan_allows_video(plan) then
    raise exception 'PLAN_RESTRICTED' using errcode = '42501',
      detail = json_build_object('reason', 'video', 'plan', plan)::text;
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

  perform private.credit_op(p_workspace, 'reserve', p_credits, 'reserve:pipe:' || new_id, new_id);
  insert into public.pipeline_assets (pipeline_id, workspace_id, type)
  select new_id, p_workspace, t from unnest(enum_range(null::public.asset_type)) as t
  where t <> 'video' or wants_video;
  return query select new_id, true;
end
$$;

revoke all on function public.create_pipeline_with_reservation from public, anon, authenticated;
grant execute on function public.create_pipeline_with_reservation to service_role;

-- Bail d'une génération longue (vidéo : images, voix, rendu en plusieurs étapes) : chaque étape
-- repousse started_at, ce qui empêche une autre exécution de la reprendre (claim_generation, 15 min)
-- et le balayage de la croire abandonnée (sweep_stale_reservations, 30 min sans activité).
create or replace function public.touch_generation(p_generation uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with touched as (
    update public.generations set started_at = now() where id = p_generation and status = 'running' returning 1
  )
  select exists (select 1 from touched)
$$;

revoke all on function public.touch_generation from public, anon, authenticated;
grant execute on function public.touch_generation to service_role;

-- Médias des pipelines : `<workspace_id>/<pipeline_id>/...`. Écriture par le service role seulement
-- (worker Inngest) ; lecture par les membres du workspace, pour créer des liens signés.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pipeline-media', 'pipeline-media', false, 52428800, array['image/jpeg', 'image/png', 'audio/mpeg', 'application/x-subrip', 'application/json'])
on conflict (id) do nothing;

create policy media_member_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pipeline-media'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and private.has_role(((storage.foldername(name))[1])::uuid)
  );
