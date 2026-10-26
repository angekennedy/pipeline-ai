-- 0004 functions : opérations atomiques et idempotentes, appelées en service role uniquement.

-- Crédits : réservation, capture, libération. Idempotent par clé ; solde verrouillé par FOR UPDATE.
create or replace function private.credit_op(
  p_ws uuid, p_kind public.ledger_kind, p_amount int, p_key text,
  p_pipeline uuid default null, p_generation uuid default null, p_meta jsonb default '{}'
)
returns public.credit_ledger
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc public.credit_accounts;
  entry public.credit_ledger;
begin
  select * into entry from public.credit_ledger where idempotency_key = p_key;
  if found then return entry; end if;

  insert into public.credit_accounts (workspace_id) values (p_ws) on conflict do nothing;
  select * into acc from public.credit_accounts where workspace_id = p_ws for update;

  case p_kind
    when 'grant', 'purchase', 'refund' then acc.balance := acc.balance + p_amount;
    when 'reserve' then
      if acc.balance - acc.reserved < p_amount then
        raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
      end if;
      acc.reserved := acc.reserved + p_amount;
    when 'capture' then
      acc.reserved := acc.reserved - p_amount;
      acc.balance := acc.balance - p_amount;
    when 'release' then acc.reserved := acc.reserved - p_amount;
    when 'adjust', 'expire' then acc.balance := greatest(acc.reserved, acc.balance - p_amount);
  end case;

  update public.credit_accounts set balance = acc.balance, reserved = acc.reserved, updated_at = now()
  where workspace_id = p_ws;
  insert into public.credit_ledger (workspace_id, kind, amount, balance_after, reserved_after, idempotency_key, pipeline_id, generation_id, metadata)
  values (p_ws, p_kind, p_amount, acc.balance, acc.reserved, p_key, p_pipeline, p_generation, p_meta)
  returning * into entry;
  return entry;
end
$$;
revoke all on function private.credit_op from public, anon, authenticated;

-- Pipelines (PipelineStore, src/lib/supabase/pipeline-store.ts) -----------------------------------

-- Crée la génération, ou renvoie celle qui porte déjà cette clé.
create or replace function public.upsert_generation(
  p_pipeline uuid, p_type public.asset_type, p_key text, p_credits int, p_feedback text default null
)
returns public.generations
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  generation public.generations;
begin
  select workspace_id into ws from public.pipelines where id = p_pipeline;
  if ws is null then raise exception 'PIPELINE_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.generations (workspace_id, pipeline_id, asset_type, idempotency_key, credits, user_feedback)
  values (ws, p_pipeline, p_type, p_key, p_credits, p_feedback)
  on conflict (idempotency_key) do nothing;
  select * into generation from public.generations where idempotency_key = p_key;
  return generation;
end
$$;

-- Prend la génération pour une tentative. Refusée (false) si une autre exécution la tient déjà,
-- sauf bail expiré (15 min) : deux exécutions simultanées d'une étape ne paient pas deux appels.
create or replace function public.claim_generation(p_generation uuid, p_attempt int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed public.generations;
begin
  update public.generations
  set status = 'running', attempt = p_attempt, started_at = now(), error_code = null, error_message = null
  where id = p_generation
    and status <> 'succeeded'
    and (status <> 'running' or started_at < now() - interval '15 minutes')
  returning * into claimed;
  if not found then return false; end if;

  insert into public.pipeline_assets (pipeline_id, workspace_id, type, status)
  values (claimed.pipeline_id, claimed.workspace_id, claimed.asset_type, 'running')
  on conflict (pipeline_id, type) do update set status = 'running';
  return true;
end
$$;

-- Une seule transaction : version immuable (numéro suivant), pointeur courant, statut de l'asset et,
-- pour une génération, son statut et sa télémétrie.
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
  next_version int;
  new_version_id uuid;
begin
  select workspace_id into ws from public.pipelines where id = p_pipeline;
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
    where id = p_generation;
  end if;
  return new_version_id;
end
$$;

-- Échec d'une génération. L'asset ne passe en échec que s'il n'a encore aucune version : une
-- régénération ratée laisse la version courante en place, et l'asset redevient prêt.
create or replace function public.mark_generation_failed(p_generation uuid, p_code text, p_message text, p_cost_usd_micros bigint default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  failed public.generations;
begin
  update public.generations
  set status = 'failed', error_code = p_code, error_message = left(p_message, 2000), cost_usd_micros = p_cost_usd_micros, finished_at = now()
  where id = p_generation
  returning * into failed;
  if not found then return; end if;
  update public.pipeline_assets
  set status = case when current_version_id is null then 'failed'::public.asset_status else 'ready' end
  where pipeline_id = failed.pipeline_id and type = failed.asset_type;
end
$$;

revoke all on function public.upsert_generation, public.claim_generation, public.commit_asset_version, public.mark_generation_failed
  from public, anon, authenticated;
grant execute on function public.upsert_generation, public.claim_generation, public.commit_asset_version, public.mark_generation_failed
  to service_role;
