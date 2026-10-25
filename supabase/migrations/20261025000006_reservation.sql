-- 0006 reservation : création d'un pipeline avec réservation de ses crédits (ARCHITECTURE §5.2).
-- Appelée en service role par la Server Action, après validation du brief.

-- credit_op relit la clé une fois le verrou pris. Deux appels simultanés avec la même clé passent tous
-- deux le premier contrôle ; le second, mis en attente par FOR UPDATE, renvoie alors l'écriture du
-- premier au lieu d'échouer sur unique(idempotency_key).
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

  select * into entry from public.credit_ledger where idempotency_key = p_key;
  if found then return entry; end if;

  case p_kind
    when 'grant', 'purchase', 'refund' then acc.balance := acc.balance + p_amount;
    when 'reserve' then
      if acc.balance - acc.reserved < p_amount then
        raise exception 'INSUFFICIENT_CREDITS' using
          errcode = 'P0001',
          detail = json_build_object('required', p_amount, 'available', acc.balance - acc.reserved)::text;
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

-- Une seule transaction : pipeline, réservation de son coût total et assets `pending`. Idempotente
-- par (workspace, clé) : un double clic renvoie le pipeline déjà créé (created = false) sans
-- réserver une seconde fois. Crédits insuffisants : rien n'est créé (INSUFFICIENT_CREDITS).
-- Les droits sont revérifiés ici (seconde couche) : en service role, auth.uid() est vide.
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
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace and m.user_id = p_user and m.role >= 'editor'
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
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
