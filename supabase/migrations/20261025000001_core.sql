-- 0001 core : workspaces, presets de chaîne, pipelines, assets versionnés, générations.
-- Écritures sensibles en service role uniquement (Server Actions, Inngest) ; lecture par la RLS (0003).

create schema if not exists private; -- non exposé par PostgREST (config.toml : api.schemas)

create type public.member_role as enum ('viewer', 'editor', 'admin', 'owner'); -- l'ordre sert aux comparaisons
create type public.asset_type as enum ('script', 'titles', 'seo', 'voiceover', 'thumbnails');
create type public.pipeline_status as enum ('queued', 'running', 'partial', 'completed', 'failed', 'canceled');
create type public.asset_status as enum ('pending', 'running', 'ready', 'failed', 'stale');
create type public.gen_status as enum ('queued', 'running', 'succeeded', 'failed');
create type public.version_source as enum ('ai', 'ai_regen', 'user_edit', 'restore');

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  locale text not null default 'fr',
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null,
  stripe_customer_id text unique,
  plan_key text not null default 'free',
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role public.member_role not null default 'editor',
  primary key (workspace_id, user_id)
);
create index on public.workspace_members (user_id);

-- Presets de chaîne (ChannelPresetSchema), saisis par les membres : contenu non fiable.
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null,
  niche text not null,
  default_language text not null default 'fr',
  tone text,
  style text,
  audience text,
  voice_profile jsonb not null default '{}',
  brand_rules jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.channels (workspace_id);

create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  channel_id uuid references public.channels on delete set null,
  created_by uuid not null references auth.users,
  brief jsonb not null, -- BriefSchema validé, figé à la création
  channel_snapshot jsonb, -- copie du preset à la création (reproductibilité)
  model_tier text not null default 'standard' check (model_tier in ('standard', 'premium')),
  status public.pipeline_status not null default 'queued',
  idempotency_key text not null,
  credits_reserved int not null default 0,
  title text generated always as (brief ->> 'topic') stored,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, idempotency_key)
);
create index on public.pipelines (workspace_id, created_at desc);

-- Un asset par (pipeline, type) ; current_version_id pointe la version courante.
create table public.pipeline_assets (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade, -- dénormalisé pour la RLS
  type public.asset_type not null,
  status public.asset_status not null default 'pending',
  current_version_id uuid,
  unique (pipeline_id, type)
);
create index on public.pipeline_assets (workspace_id);

-- Versions IMMUABLES : une régénération, une édition ou une restauration ajoute une version.
create table public.asset_versions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.pipeline_assets on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  version int not null check (version >= 1),
  source public.version_source not null,
  content jsonb not null, -- sortie validée par Zod et post-traitée
  schema_version text not null, -- ex. 'script@1'
  -- Version (d'origine) de chaque dépendance utilisée : base du calcul d'obsolescence (staleness.ts).
  source_versions jsonb not null default '{}',
  restored_from uuid references public.asset_versions, -- restauration : version d'origine copiée
  generation_id uuid, -- null pour une édition ou une restauration
  created_by uuid references auth.users,
  created_at timestamptz not null default now(),
  unique (asset_id, version)
);
create index on public.asset_versions (asset_id, version desc);
create index on public.asset_versions (workspace_id);

alter table public.pipeline_assets
  add constraint fk_current foreign key (current_version_id) references public.asset_versions deferrable initially deferred;

-- Un appel au modèle pour un asset = une ligne (job et télémétrie).
create table public.generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  pipeline_id uuid not null references public.pipelines on delete cascade,
  asset_type public.asset_type not null,
  idempotency_key text not null unique, -- 'pipe:<id>:<type>' ou 'regen:<nonce>'
  status public.gen_status not null default 'queued',
  attempt int not null default 0,
  started_at timestamptz, -- début de la tentative en cours : bail de la prise (claim_generation)
  version_id uuid references public.asset_versions, -- version produite, quand status = succeeded
  model text,
  prompt_version text,
  input_tokens int,
  output_tokens int,
  cache_creation_tokens int,
  cache_read_tokens int,
  cost_usd_micros bigint,
  latency_ms int,
  api_calls int, -- appels à l'API pendant la tentative (réparation, relance sur max_tokens)
  credits int not null,
  validation_repairs int not null default 0,
  error_code text,
  error_message text,
  inngest_run_id text,
  user_feedback text, -- consigne de régénération (non fiable)
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on public.generations (pipeline_id);
create index on public.generations (workspace_id, created_at desc);
create index on public.generations (status) where status in ('queued', 'running');
