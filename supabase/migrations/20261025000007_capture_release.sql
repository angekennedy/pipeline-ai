-- 0007 capture et libération des crédits d'un pipeline (ARCHITECTURE §5.2, tâche 3.2).
--
-- Écritures du registre d'un pipeline, toutes rattachées à pipeline_id :
--   reserve:pipe:<id>          coût total, à la création (0006)
--   capture:pipe:<id>:<type>   coût de l'asset, dans la transaction de sa version
--   release:pipe:<id>          reliquat, au statut terminal
-- Ordre des verrous, partout : ligne du pipeline, puis compte de crédits. Une capture et une
-- finalisation simultanées se suivent donc sans interblocage, et le reliquat est calculé sous verrou.

create index on public.credit_ledger (pipeline_id);

-- Crédits réservés pour ce pipeline et pas encore capturés ni libérés.
create or replace function private.pipeline_reservation_remaining(p_pipeline uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case when kind = 'reserve' then amount else -amount end), 0)::int
  from public.credit_ledger
  where pipeline_id = p_pipeline
    and (
      idempotency_key = 'reserve:pipe:' || p_pipeline
      or idempotency_key = 'release:pipe:' || p_pipeline
      or idempotency_key like 'capture:pipe:' || p_pipeline || ':%'
    )
$$;
revoke all on function private.pipeline_reservation_remaining from public, anon, authenticated;

-- 0004 + capture : la version, le pointeur courant, la génération et la capture de son coût forment
-- une seule transaction. Pas de capture hors réservation (pipeline créé sans réserve, régénération
-- dont la facturation vient avec sa Server Action) ni au-delà du reliquat : une génération qui se
-- termine après l'annulation du pipeline est enregistrée sans être facturée.
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
  capturable int;
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
      if capturable > 0 then
        perform private.credit_op(ws, 'capture', capturable, 'capture:' || gen.idempotency_key, p_pipeline, p_generation);
      end if;
    end if;
  end if;
  return new_version_id;
end
$$;

-- Statut terminal et libération du reliquat (assets échoués, sautés ou annulés). Idempotente : une
-- seconde finalisation ne trouve plus rien à libérer. Renvoie le nombre de crédits libérés.
create or replace function public.finalize_pipeline(p_pipeline uuid, p_status public.pipeline_status)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  remaining int;
begin
  if p_status not in ('completed', 'partial', 'failed', 'canceled') then
    raise exception 'NOT_TERMINAL' using errcode = '22023';
  end if;
  select workspace_id into ws from public.pipelines where id = p_pipeline for update;
  if ws is null then raise exception 'PIPELINE_NOT_FOUND' using errcode = 'P0002'; end if;

  update public.pipelines set status = p_status, completed_at = coalesce(completed_at, now()) where id = p_pipeline;
  remaining := private.pipeline_reservation_remaining(p_pipeline);
  if remaining > 0 then
    perform private.credit_op(ws, 'release', remaining, 'release:pipe:' || p_pipeline, p_pipeline);
  end if;
  return greatest(remaining, 0);
end
$$;

-- Filet de sécurité si Inngest ne finalise pas (panne, exécution perdue) : un pipeline encore
-- `queued` ou `running` sans activité depuis p_idle passe en échec et libère sa réservation.
-- L'activité est la dernière prise ou fin de génération, pour ne pas balayer un pipeline lent ou
-- en file d'attente derrière la limite de concurrence du workspace. Renvoie le nombre balayé.
create or replace function public.sweep_stale_reservations(p_idle interval default '30 minutes')
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  stale uuid;
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
  return swept;
end
$$;

revoke all on function public.commit_asset_version, public.finalize_pipeline, public.sweep_stale_reservations
  from public, anon, authenticated;
grant execute on function public.commit_asset_version, public.finalize_pipeline, public.sweep_stale_reservations
  to service_role;
