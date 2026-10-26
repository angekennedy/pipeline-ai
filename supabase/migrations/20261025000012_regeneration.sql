-- 0012 facturation des régénérations (tâche 4.2) : même cycle que la génération d'un pipeline
-- (ARCHITECTURE §5.2), avec une clé par demande, `regen:<nonce>` (generations.idempotency_key) :
--   reserve:regen:<nonce>   coût de l'asset, à la demande (Server Action)
--   capture:regen:<nonce>   dans la transaction de la nouvelle version
--   release:regen:<nonce>   reliquat, quand la régénération échoue définitivement (onFailure Inngest)
--                           ou reste sans activité (balayage)
-- Les écritures portent le pipeline_id : l'ordre des verrous (pipeline, puis compte) reste le même.

-- Crédits réservés pour cette régénération et pas encore capturés ni libérés.
create or replace function private.regeneration_remaining(p_key text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case when kind = 'reserve' then amount else -amount end), 0)::int
  from public.credit_ledger
  where idempotency_key in ('reserve:' || p_key, 'capture:' || p_key, 'release:' || p_key)
$$;

-- Réserve le coût d'une régénération. Idempotente par clé : un double clic ne réserve qu'une fois.
-- Mêmes refus que la création d'un pipeline : rôle, abonnement en retard, Premium hors plan, solde.
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

  select w.plan_key into plan from public.workspaces w where w.id = p_workspace;
  select * into limits from private.plan_limits(plan);
  if private.subscription_past_due(p_workspace) then
    raise exception 'PLAN_RESTRICTED' using errcode = '42501',
      detail = json_build_object('reason', 'subscription_past_due', 'plan', plan)::text;
  end if;
  if p_tier = 'premium' and not limits.premium then
    raise exception 'PLAN_RESTRICTED' using errcode = '42501',
      detail = json_build_object('reason', 'premium', 'plan', plan)::text;
  end if;
  if p_credits <= 0 then raise exception 'INVALID_CREDITS' using errcode = '22023'; end if;

  perform private.credit_op(p_workspace, 'reserve', p_credits, 'reserve:' || p_key, p_pipeline);
  return true;
end
$$;

-- Libère le reliquat d'une régénération. Idempotente. Renvoie le nombre de crédits libérés.
create or replace function public.release_regeneration(p_key text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation public.credit_ledger;
  remaining int;
begin
  select * into reservation from public.credit_ledger l where l.idempotency_key = 'reserve:' || p_key;
  if not found then return 0; end if;
  perform 1 from public.pipelines p where p.id = reservation.pipeline_id for update;
  remaining := private.regeneration_remaining(p_key);
  if remaining > 0 then
    perform private.credit_op(reservation.workspace_id, 'release', remaining, 'release:' || p_key, reservation.pipeline_id);
  end if;
  return greatest(remaining, 0);
end
$$;

-- 0007 + capture des régénérations : plafonnée au reliquat de leur réservation (aucune capture sans
-- réservation, ni après une libération).
create or replace function public.commit_asset_version(
  p_pipeline uuid, p_type public.asset_type, p_content jsonb, p_schema_version text,
  p_source public.version_source, p_source_versions jsonb, p_restored_from uuid default null,
  p_generation uuid default null, p_telemetry jsonb default null, p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  asset public.pipeline_assets;
  gen public.generations;
  next_version int;
  new_version_id uuid;
  capturable int := 0;
begin
  select workspace_id into ws from public.pipelines where id = p_pipeline for update;
  if ws is null then raise exception 'PIPELINE_NOT_FOUND' using errcode = 'P0002'; end if;

  insert into public.pipeline_assets (pipeline_id, workspace_id, type) values (p_pipeline, ws, p_type)
  on conflict (pipeline_id, type) do nothing;
  select * into asset from public.pipeline_assets where pipeline_id = p_pipeline and type = p_type for update;

  select coalesce(max(version), 0) + 1 into next_version from public.asset_versions where asset_id = asset.id;
  insert into public.asset_versions (asset_id, workspace_id, version, source, content, schema_version, source_versions, restored_from, generation_id, created_by)
  values (asset.id, ws, next_version, p_source, p_content, p_schema_version, p_source_versions, p_restored_from, p_generation, p_created_by)
  returning id into new_version_id;
  update public.pipeline_assets set current_version_id = new_version_id, status = 'ready' where id = asset.id;

  if p_generation is not null then
    update public.generations set
      status = 'succeeded',
      version_id = new_version_id,
      finished_at = now(),
      model = p_telemetry ->> 'model',
      prompt_version = p_telemetry ->> 'promptVersion',
      input_tokens = (p_telemetry -> 'usage' ->> 'inputTokens')::int,
      output_tokens = (p_telemetry -> 'usage' ->> 'outputTokens')::int,
      cache_read_tokens = (p_telemetry -> 'usage' ->> 'cacheReadTokens')::int,
      cache_creation_tokens = (p_telemetry -> 'usage' ->> 'cacheCreationTokens')::int,
      cost_usd_micros = (p_telemetry ->> 'costUsdMicros')::bigint,
      latency_ms = (p_telemetry ->> 'latencyMs')::int,
      validation_repairs = (p_telemetry ->> 'repairs')::int,
      api_calls = (p_telemetry ->> 'attempts')::int
    where id = p_generation
    returning * into gen;

    if gen.idempotency_key like 'pipe:%' then
      capturable := least(gen.credits, private.pipeline_reservation_remaining(p_pipeline));
    elsif gen.idempotency_key like 'regen:%' then
      capturable := least(gen.credits, private.regeneration_remaining(gen.idempotency_key));
    end if;
    if capturable > 0 then
      perform private.credit_op(ws, 'capture', capturable, 'capture:' || gen.idempotency_key, p_pipeline, p_generation);
    end if;
  end if;
  return new_version_id;
end
$$;

-- 0007 + régénérations : une réservation `reserve:regen:` encore ouverte, sans génération réussie ni
-- activité depuis p_idle (exécution perdue, onFailure non abouti), est libérée. Renvoie le nombre de
-- pipelines et de régénérations balayés.
create or replace function public.sweep_stale_reservations(p_idle interval default '30 minutes')
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  stale uuid;
  regen text;
  swept int := 0;
begin
  for stale in
    select p.id from public.pipelines p
    where p.status in ('queued', 'running')
      and greatest(
        p.created_at,
        (select max(greatest(g.created_at, g.started_at, g.finished_at)) from public.generations g where g.pipeline_id = p.id)
      ) < now() - p_idle
    for update of p skip locked
  loop
    update public.pipeline_assets set status = 'failed' where pipeline_id = stale and status in ('pending', 'running');
    perform public.finalize_pipeline(stale, 'failed');
    swept := swept + 1;
  end loop;

  for regen in
    select substr(r.idempotency_key, length('reserve:') + 1) from public.credit_ledger r
    where r.kind = 'reserve' and r.idempotency_key like 'reserve:regen:%'
      and private.regeneration_remaining(substr(r.idempotency_key, length('reserve:') + 1)) > 0
      and greatest(
        r.created_at,
        (select max(greatest(g.created_at, g.started_at, g.finished_at)) from public.generations g
         where g.idempotency_key = substr(r.idempotency_key, length('reserve:') + 1))
      ) < now() - p_idle
      and not exists (
        select 1 from public.generations g
        where g.idempotency_key = substr(r.idempotency_key, length('reserve:') + 1) and g.status = 'succeeded'
      )
  loop
    perform public.release_regeneration(regen);
    swept := swept + 1;
  end loop;
  return swept;
end
$$;

revoke all on function private.regeneration_remaining from public, anon, authenticated;
revoke all on function public.reserve_regeneration, public.release_regeneration, public.commit_asset_version, public.sweep_stale_reservations
  from public, anon, authenticated;
grant execute on function public.reserve_regeneration, public.release_regeneration, public.commit_asset_version, public.sweep_stale_reservations
  to service_role;
