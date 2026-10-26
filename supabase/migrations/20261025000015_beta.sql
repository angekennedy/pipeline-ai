-- 0015 bêta fermée (tâche 5.6) : inscriptions sur invitation et question NPS.
--   app_settings        réglages modifiables sans redéploiement (ici : beta_invite_only)
--   beta_invites        adresses invitées, en minuscules
--   beta_gate           trigger avant la création d'un compte : en mode bêta, une adresse non invitée
--                       est refusée, quelle que soit la voie (lien magique, Google, API admin)
--   nps_responses       une réponse par utilisateur, sous RLS
-- Les comptes existants ne sont pas concernés : le contrôle n'a lieu qu'à la création.

create table private.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into private.app_settings (key, value) values ('beta_invite_only', 'false');

create table private.beta_invites (
  email text primary key check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  note text check (char_length(note) <= 200),
  invited_at timestamptz not null default now()
);

create or replace function private.beta_invite_only()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value)::boolean from private.app_settings s where s.key = 'beta_invite_only'), false)
$$;

create or replace function private.beta_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.beta_invite_only() and not exists (select 1 from private.beta_invites i where i.email = lower(new.email)) then
    raise exception 'BETA_INVITE_ONLY' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger beta_gate
  before insert on auth.users
  for each row execute function private.beta_gate();

-- Avant d'envoyer un lien magique : l'adresse pourra-t-elle se connecter ? Oui hors mode bêta, pour
-- une adresse invitée, ou pour un compte qui existe déjà.
create or replace function public.beta_can_sign_in(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not private.beta_invite_only()
    or exists (select 1 from private.beta_invites i where i.email = lower(p_email))
    or exists (select 1 from auth.users u where lower(u.email) = lower(p_email))
$$;

-- Administration (page /admin, service role).
create or replace function public.beta_settings()
returns table (invite_only boolean, invites jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select private.beta_invite_only(),
         coalesce((select jsonb_agg(jsonb_build_object('email', i.email, 'note', i.note, 'invited_at', i.invited_at) order by i.invited_at desc) from private.beta_invites i), '[]')
$$;

create or replace function public.set_beta_invite_only(p_enabled boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.app_settings set value = to_jsonb(p_enabled), updated_at = now() where key = 'beta_invite_only'
$$;

create or replace function public.add_beta_invite(p_email text, p_note text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.beta_invites (email, note) values (lower(trim(p_email)), nullif(trim(p_note), ''))
  on conflict (email) do update set note = excluded.note
$$;

create or replace function public.remove_beta_invite(p_email text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.beta_invites where email = lower(trim(p_email))
$$;

-- NPS : « Recommanderiez-vous Pipeline AI ? » de 0 à 10. Une réponse par utilisateur, modifiable.
create table public.nps_responses (
  user_id uuid primary key references auth.users on delete cascade,
  score int not null check (score between 0 and 10),
  comment text check (char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.nps_responses enable row level security;
create policy nps_own_read on public.nps_responses for select to authenticated using (user_id = auth.uid());
create policy nps_own_insert on public.nps_responses for insert to authenticated with check (user_id = auth.uid());
create policy nps_own_update on public.nps_responses for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Synthèse pour /admin : NPS = % de promoteurs (9-10) − % de détracteurs (0-6).
create or replace function public.nps_summary()
returns table (responses int, promoters int, passives int, detractors int)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int,
         (count(*) filter (where n.score >= 9))::int,
         (count(*) filter (where n.score between 7 and 8))::int,
         (count(*) filter (where n.score <= 6))::int
  from public.nps_responses n
$$;

revoke all on private.app_settings, private.beta_invites from public, anon, authenticated;
revoke all on function private.beta_invite_only, private.beta_gate from public, anon, authenticated;
revoke all on function public.beta_can_sign_in, public.beta_settings, public.set_beta_invite_only, public.add_beta_invite,
  public.remove_beta_invite, public.nps_summary from public, anon, authenticated;
grant execute on function public.beta_can_sign_in, public.beta_settings, public.set_beta_invite_only, public.add_beta_invite,
  public.remove_beta_invite, public.nps_summary to service_role;
