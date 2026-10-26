-- 0013 rate limits et disjoncteur de dépense (tâche 4.5, ARCHITECTURE §6), dans Postgres plutôt
-- qu'Upstash : pas de service de plus, et le même test de concurrence que les réservations.
--   rate_limit_hit   fenêtre glissante exacte (un horodatage par demande acceptée), plusieurs
--                    compteurs vérifiés ensemble : une demande refusée par l'un n'entame aucun autre
--   spend_since      dépense LLM (`generations.cost_usd_micros`) depuis une date, globale ou d'un workspace
-- Les compteurs sont nommés par l'application (`pipeline:user:<id>`, `login:email:<sha256>`) : ni
-- e-mail ni IP en clair.

create table private.rate_limit_hits (
  bucket text not null,
  hit_at timestamptz not null default clock_timestamp()
);
create index on private.rate_limit_hits (bucket, hit_at);

-- 0 : demande acceptée et comptée dans chaque compteur. Sinon, secondes à attendre avant que le
-- compteur le plus contraint libère une place ; rien n'est compté.
create or replace function public.rate_limit_hit(p_buckets text[], p_limits int[], p_windows int[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int := coalesce(array_length(p_buckets, 1), 0);
  now_ts timestamptz;
  retry_after int := 0;
  hits int;
  oldest timestamptz;
  bucket text;
begin
  if n = 0 or n > 5 or array_length(p_limits, 1) is distinct from n or array_length(p_windows, 1) is distinct from n then
    raise exception 'INVALID_RATE_LIMIT' using errcode = '22023';
  end if;
  for i in 1..n loop
    if p_buckets[i] !~ '^[\w:.-]{3,128}$' or p_limits[i] not between 1 and 10000 or p_windows[i] not between 1 and 86400 then
      raise exception 'INVALID_RATE_LIMIT' using errcode = '22023';
    end if;
  end loop;

  -- Verrous dans l'ordre des noms : deux demandes qui partagent des compteurs ne s'interbloquent pas.
  for bucket in select distinct b from unnest(p_buckets) as b order by b loop
    perform pg_advisory_xact_lock(hashtextextended('rate_limit:' || bucket, 0));
  end loop;
  now_ts := clock_timestamp(); -- après les verrous : l'ordre des horodatages suit celui des demandes

  for i in 1..n loop
    delete from private.rate_limit_hits h
    where h.bucket = p_buckets[i] and h.hit_at <= now_ts - make_interval(secs => p_windows[i]);
    select count(*), min(h.hit_at) into hits, oldest from private.rate_limit_hits h where h.bucket = p_buckets[i];
    if hits >= p_limits[i] then
      retry_after := greatest(retry_after, ceil(extract(epoch from oldest + make_interval(secs => p_windows[i]) - now_ts))::int, 1);
    end if;
  end loop;
  if retry_after > 0 then return retry_after; end if;

  insert into private.rate_limit_hits (bucket, hit_at) select b, now_ts from unnest(p_buckets) as b;
  return 0;
end
$$;

-- Compteurs restés inactifs : leurs horodatages ne sont purgés par aucune demande. La fenêtre la
-- plus longue est d'un jour. Appelée par le balayage périodique (Inngest).
create or replace function public.purge_rate_limits()
returns int
language sql
security definer
set search_path = ''
as $$
  with purged as (delete from private.rate_limit_hits where hit_at < clock_timestamp() - interval '1 day' returning 1)
  select count(*)::int from purged
$$;

create index on public.generations (created_at);

-- Dépense LLM en micro-dollars depuis `p_since`, de tous les workspaces ou d'un seul. Les appels
-- échoués restent facturés par l'API et comptent aussi.
create or replace function public.spend_since(p_since timestamptz, p_workspace uuid default null)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(g.cost_usd_micros), 0)::bigint
  from public.generations g
  where g.created_at >= p_since and (p_workspace is null or g.workspace_id = p_workspace)
$$;

revoke all on function public.rate_limit_hit, public.purge_rate_limits, public.spend_since from public, anon, authenticated;
grant execute on function public.rate_limit_hit, public.purge_rate_limits, public.spend_since to service_role;
