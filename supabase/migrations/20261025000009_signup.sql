-- 0009 inscription (tâche 2.2) : chaque nouvel utilisateur reçoit un profil, un workspace personnel
-- dont il est owner, et les crédits offerts du plan Free. Il peut générer dès sa première connexion.

-- Crédits offerts à l'inscription : PLANS.free.credits (src/lib/billing/plans.ts), dont un test
-- d'intégration vérifie la parité.
create or replace function private.signup_credits()
returns int
language sql
immutable
set search_path = ''
as $$ select 30 $$;

-- Slug lisible et unique : la partie locale de l'e-mail, sans accents (translate, sans extension) et
-- normalisée, suivie de 8 caractères de l'id. Respecte le CHECK de workspaces.slug (^[a-z0-9-]{3,40}$).
create or replace function private.personal_slug(p_user uuid, p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(left(trim(both '-' from regexp_replace(translate(lower(split_part(coalesce(p_email, ''), '@', 1)), 'àâäáãåçéèêëíìîïñóòôöõøúùûüýÿ', 'aaaaaaceeeeiiiinoooooouuuuyy'), '[^a-z0-9]+', '-', 'g')), 24), ''), 'espace')
    || '-' || left(replace(p_user::text, '-', ''), 8)
$$;

-- Idempotente : un utilisateur déjà doté d'un workspace personnel n'en reçoit pas un second, et la clé
-- `grant:signup:<user>` garantit un seul crédit offert (credit_op).
create or replace function private.provision_user(p_user uuid, p_email text, p_meta jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  display text := coalesce(
    nullif(trim(p_meta ->> 'full_name'), ''),
    nullif(trim(p_meta ->> 'name'), ''),
    nullif(split_part(coalesce(p_email, ''), '@', 1), ''),
    'Mon espace'
  );
  ws uuid;
begin
  insert into public.profiles (id, display_name) values (p_user, left(display, 80)) on conflict (id) do nothing;

  select m.workspace_id into ws from public.workspace_members m
  where m.user_id = p_user and m.role = 'owner'
  order by m.workspace_id limit 1;

  if ws is null then
    insert into public.workspaces (slug, name)
    values (private.personal_slug(p_user, p_email), left('Espace de ' || display, 80))
    returning id into ws;
    insert into public.workspace_members (workspace_id, user_id, role) values (ws, p_user, 'owner');
  end if;

  perform private.credit_op(ws, 'grant', private.signup_credits(), 'grant:signup:' || p_user, p_meta => '{"reason": "signup"}');
  return ws;
end
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.provision_user(new.id, new.email, new.raw_user_meta_data);
  return new;
end
$$;

revoke all on function private.signup_credits, private.personal_slug, private.provision_user, private.handle_new_user
  from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Rattrapage : les comptes créés avant ce trigger (staging) reçoivent leur workspace et leurs crédits.
select private.provision_user(u.id, u.email, u.raw_user_meta_data)
from auth.users u
where not exists (select 1 from public.workspace_members m where m.user_id = u.id and m.role = 'owner');
