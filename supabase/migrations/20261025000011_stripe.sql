-- 0011 Stripe (tâches 3.3 et 3.4) : écritures de la synchronisation (fonction stripe-sync), en service
-- role uniquement. Chaque fonction est idempotente : un événement rejoué, ou reçu dans le désordre,
-- ne crédite qu'une fois et ne laisse que l'état relu chez Stripe.

-- Le client Stripe d'un workspace. Un client déjà lié à un autre workspace est refusé (unique).
create or replace function public.stripe_link_customer(p_workspace uuid, p_customer text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.workspaces set stripe_customer_id = p_customer
  where id = p_workspace and stripe_customer_id is distinct from p_customer
$$;

-- État d'un abonnement, relu chez Stripe, et plan du workspace qui en découle : le plan de
-- l'abonnement tant qu'il donne accès au service (actif, en essai, en retard de paiement), Free sinon.
-- Renvoie le plan précédent du workspace (calcul d'un upgrade en cours de période).
create or replace function public.stripe_apply_subscription(
  p_workspace uuid, p_subscription text, p_status text, p_price text, p_plan text,
  p_period_end timestamptz, p_cancel_at_period_end boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous text;
begin
  select w.plan_key into previous from public.workspaces w where w.id = p_workspace for update;
  if previous is null then raise exception 'WORKSPACE_NOT_FOUND' using errcode = 'P0002'; end if;

  insert into public.subscriptions (id, workspace_id, status, price_id, plan_key, current_period_end, cancel_at_period_end, updated_at)
  values (p_subscription, p_workspace, p_status, p_price, p_plan, p_period_end, p_cancel_at_period_end, now())
  on conflict (id) do update set
    status = excluded.status, price_id = excluded.price_id, plan_key = excluded.plan_key,
    current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
    updated_at = now();

  -- Plusieurs abonnements (ancien annulé, nouveau actif) : le plan vient de celui qui donne accès.
  update public.workspaces w set plan_key = coalesce((
    select s.plan_key from public.subscriptions s
    where s.workspace_id = p_workspace and s.status in ('active', 'trialing', 'past_due')
    order by s.updated_at desc limit 1
  ), 'free')
  where w.id = p_workspace;
  return previous;
end
$$;

-- Crédit lié à Stripe (achat de pack, allocation, upgrade, remboursement), avec sa référence Stripe.
create or replace function public.stripe_credit(
  p_workspace uuid, p_kind public.ledger_kind, p_amount int, p_key text, p_ref text, p_meta jsonb default '{}'
)
returns public.credit_ledger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.credit_ledger;
begin
  if p_kind not in ('grant', 'purchase', 'expire', 'adjust') then
    raise exception 'INVALID_KIND' using errcode = '22023';
  end if;
  entry := private.credit_op(p_workspace, p_kind, p_amount, p_key, p_meta => p_meta);
  if entry.stripe_ref is null then
    update public.credit_ledger set stripe_ref = p_ref where id = entry.id returning * into entry;
  end if;
  return entry;
end
$$;

-- Renouvellement (facture payée) : le report est plafonné à une allocation mensuelle (ARCHITECTURE
-- §5.1), puis l'allocation est créditée. Les deux écritures portent la clé de la facture.
create or replace function public.stripe_renew(p_workspace uuid, p_invoice text, p_allocation int, p_meta jsonb default '{}')
returns public.credit_ledger
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc public.credit_accounts;
  excess int;
begin
  if p_allocation <= 0 then raise exception 'INVALID_CREDITS' using errcode = '22023'; end if;
  if exists (select 1 from public.credit_ledger l where l.idempotency_key = 'stripe:inv:' || p_invoice) then
    return (select l from public.credit_ledger l where l.idempotency_key = 'stripe:inv:' || p_invoice);
  end if;

  insert into public.credit_accounts (workspace_id) values (p_workspace) on conflict do nothing;
  select * into acc from public.credit_accounts a where a.workspace_id = p_workspace for update;
  excess := acc.balance - acc.reserved - p_allocation;
  if excess > 0 then
    perform public.stripe_credit(p_workspace, 'expire', excess, 'stripe:inv:' || p_invoice || ':expire', p_invoice, p_meta);
  end if;
  return public.stripe_credit(p_workspace, 'grant', p_allocation, 'stripe:inv:' || p_invoice, p_invoice, p_meta);
end
$$;

revoke all on function public.stripe_link_customer, public.stripe_apply_subscription, public.stripe_credit, public.stripe_renew
  from public, anon, authenticated;
grant execute on function public.stripe_link_customer, public.stripe_apply_subscription, public.stripe_credit, public.stripe_renew
  to service_role;
