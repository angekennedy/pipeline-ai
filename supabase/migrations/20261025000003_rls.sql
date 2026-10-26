-- 0003 RLS : activée sur TOUTES les tables (tests/integration/rls.test.ts le vérifie). Le client lit
-- ce que son rôle dans le workspace autorise ; les écritures sensibles passent par le service role,
-- après vérification du rôle dans la Server Action (deux couches).

-- Rôle minimal de l'utilisateur courant dans un workspace. SECURITY DEFINER : lit workspace_members
-- sans dépendre de sa propre RLS ; search_path vide contre le détournement de schéma.
create or replace function private.has_role(ws uuid, min_role public.member_role default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role >= min_role
  )
$$;

revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public;
grant execute on function private.has_role(uuid, public.member_role) to authenticated;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.channels enable row level security;
alter table public.pipelines enable row level security;
alter table public.pipeline_assets enable row level security;
alter table public.asset_versions enable row level security;
alter table public.generations enable row level security;
alter table public.credit_accounts enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security; -- aucune policy : service role uniquement

create policy own_profile on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy ws_read on public.workspaces for select to authenticated using (private.has_role(id));
create policy ws_admin on public.workspaces for update to authenticated
  using (private.has_role(id, 'admin')) with check (private.has_role(id, 'admin'));

create policy wm_read on public.workspace_members for select to authenticated using (private.has_role(workspace_id));
create policy wm_admin on public.workspace_members for all to authenticated
  using (private.has_role(workspace_id, 'admin')) with check (private.has_role(workspace_id, 'admin'));

create policy ch_read on public.channels for select to authenticated using (private.has_role(workspace_id));
create policy ch_write on public.channels for all to authenticated
  using (private.has_role(workspace_id, 'editor')) with check (private.has_role(workspace_id, 'editor'));

-- Pipelines : lecture pour les membres. La création passe par la Server Action en service role,
-- après réservation des crédits : aucun INSERT client, donc aucun pipeline non réservé.
create policy pl_read on public.pipelines for select to authenticated using (private.has_role(workspace_id));

-- Assets, versions, générations, crédits, abonnements : lecture seule côté client.
create policy pa_read on public.pipeline_assets for select to authenticated using (private.has_role(workspace_id));
create policy av_read on public.asset_versions for select to authenticated using (private.has_role(workspace_id));
create policy gen_read on public.generations for select to authenticated using (private.has_role(workspace_id));
create policy ca_read on public.credit_accounts for select to authenticated using (private.has_role(workspace_id));
create policy cl_read on public.credit_ledger for select to authenticated using (private.has_role(workspace_id, 'admin'));
create policy sub_read on public.subscriptions for select to authenticated using (private.has_role(workspace_id, 'admin'));
