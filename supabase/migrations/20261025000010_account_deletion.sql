-- 0010 suppression du compte (tâche 2.6, RGPD) : l'utilisateur, ses workspaces et tout leur contenu
-- (pipelines, assets, versions, générations, presets, crédits, abonnements) disparaissent en une
-- transaction. L'abonnement Stripe est annulé avant, par l'application : la base refuse tant qu'un
-- abonnement reste actif.

-- Un pipeline ou une version créés par l'utilisateur dans le workspace d'un autre restent à ce
-- workspace, sans auteur.
alter table public.pipelines alter column created_by drop not null;
alter table public.pipelines
  drop constraint pipelines_created_by_fkey,
  add constraint pipelines_created_by_fkey foreign key (created_by) references auth.users on delete set null;
alter table public.asset_versions
  drop constraint asset_versions_created_by_fkey,
  add constraint asset_versions_created_by_fkey foreign key (created_by) references auth.users on delete set null;

-- Workspaces supprimés avec le compte : ceux dont l'utilisateur est le seul owner.
create or replace function private.sole_owned_workspaces(p_user uuid)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select m.workspace_id from public.workspace_members m
  where m.user_id = p_user and m.role = 'owner'
    and not exists (
      select 1 from public.workspace_members o
      where o.workspace_id = m.workspace_id and o.role = 'owner' and o.user_id <> p_user
    )
$$;

-- Refus, sans rien supprimer :
--   WORKSPACE_SHARED : seul owner d'un workspace qui a d'autres membres (à transférer ou à vider d'abord) ;
--   SUBSCRIPTION_ACTIVE : abonnement non annulé sur un workspace à supprimer.
-- Renvoie le nombre de workspaces supprimés.
create or replace function public.delete_account(p_user uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  shared text;
  deleted int;
begin
  -- Verrou des workspaces concernés : un membre ajouté ou un abonnement créé pendant la suppression
  -- attend la fin de la transaction.
  perform 1 from public.workspaces w where w.id in (select private.sole_owned_workspaces(p_user)) for update;

  select string_agg(w.name, ', ' order by w.name) into shared
  from public.workspaces w
  where w.id in (select private.sole_owned_workspaces(p_user))
    and exists (select 1 from public.workspace_members o where o.workspace_id = w.id and o.user_id <> p_user);
  if shared is not null then
    raise exception 'WORKSPACE_SHARED' using errcode = 'P0001', detail = shared;
  end if;

  if exists (
    select 1 from public.subscriptions s
    where s.workspace_id in (select private.sole_owned_workspaces(p_user))
      and s.status not in ('canceled', 'incomplete_expired')
  ) then
    raise exception 'SUBSCRIPTION_ACTIVE' using errcode = 'P0001';
  end if;

  delete from public.workspaces w where w.id in (select private.sole_owned_workspaces(p_user));
  get diagnostics deleted = row_count;
  -- Profil et appartenances suivent (on delete cascade), comme les sessions et identités d'Auth.
  delete from auth.users u where u.id = p_user;
  return deleted;
end
$$;

revoke all on function private.sole_owned_workspaces from public, anon, authenticated;
revoke all on function public.delete_account from public, anon, authenticated;
grant execute on function public.delete_account to service_role;
