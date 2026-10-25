-- 0002 billing : registre de crédits (réservation, capture, libération), abonnements Stripe.

create type public.ledger_kind as enum ('grant', 'purchase', 'reserve', 'capture', 'release', 'refund', 'adjust', 'expire');

-- Solde matérialisé, verrouillé par FOR UPDATE dans private.credit_op (0004). Les contraintes CHECK
-- sont le dernier filet de sécurité si un bug applicatif passe.
create table public.credit_accounts (
  workspace_id uuid primary key references public.workspaces on delete cascade,
  balance int not null default 0 check (balance >= 0),
  reserved int not null default 0 check (reserved >= 0),
  check (reserved <= balance),
  updated_at timestamptz not null default now()
);

-- Registre en ajout seul : chaque opération porte une clé d'idempotence unique.
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  kind public.ledger_kind not null,
  amount int not null check (amount > 0),
  balance_after int not null,
  reserved_after int not null,
  idempotency_key text not null unique,
  pipeline_id uuid references public.pipelines on delete set null,
  generation_id uuid references public.generations on delete set null,
  stripe_ref text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.credit_ledger (workspace_id, created_at desc);

create table public.subscriptions (
  id text primary key, -- sub_xxx Stripe
  workspace_id uuid not null references public.workspaces on delete cascade,
  status text not null, -- active, trialing, past_due, canceled...
  price_id text not null,
  plan_key text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);
create index on public.subscriptions (workspace_id);

-- Déduplication des webhooks Stripe.
create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
