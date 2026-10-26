-- 0014 coût et marge par pipeline, alertes (tâche 4.6, ARCHITECTURE « Observabilité »).
--   v_pipeline_economics   coût LLM, crédits débités, cache, latence et échecs de chaque pipeline,
--                          régénérations comprises (privée : lue par les RPC ci-dessous)
--   pipeline_economics     la vue, pour la page admin
--   cost_outliers          pipelines terminés au-delà de N fois le coût médian par minute de leur formule
--   generation_failures    générations terminées et échouées depuis une date
--   stale_reservations     réservations sans activité, que le balayage va libérer
-- Le chiffre d'affaires dépend du prix du crédit, qui dépend du plan : il est calculé côté
-- application (src/lib/admin/economics.ts).

create view private.v_pipeline_economics as
select
  p.id as pipeline_id,
  p.workspace_id,
  w.plan_key,
  p.model_tier,
  p.status,
  (p.brief ->> 'durationMinutes')::int as minutes,
  p.created_at,
  coalesce(g.cost_usd_micros, 0)::bigint as cost_usd_micros,
  coalesce(l.credits_captured, 0)::int as credits_captured,
  coalesce(g.generations, 0)::int as generations,
  coalesce(g.failed, 0)::int as failed_generations,
  coalesce(g.repairs, 0)::int as validation_repairs,
  g.cache_hit_ratio,
  g.total_latency_ms
from public.pipelines p
join public.workspaces w on w.id = p.workspace_id
left join lateral (
  select
    sum(x.cost_usd_micros) as cost_usd_micros,
    count(*) as generations,
    count(*) filter (where x.status = 'failed') as failed,
    sum(x.validation_repairs) as repairs,
    sum(x.cache_read_tokens)::float8 / nullif(sum(x.input_tokens + x.cache_read_tokens + x.cache_creation_tokens), 0) as cache_hit_ratio,
    sum(x.latency_ms)::bigint as total_latency_ms
  from public.generations x
  where x.pipeline_id = p.id
) g on true
-- Crédits réellement débités : les captures du registre, génération et régénérations.
left join lateral (
  select sum(c.amount) as credits_captured from public.credit_ledger c where c.pipeline_id = p.id and c.kind = 'capture'
) l on true;

create or replace function public.pipeline_economics(p_since timestamptz, p_limit int default 100)
returns table (
  pipeline_id uuid, workspace_id uuid, plan_key text, model_tier text, status public.pipeline_status, minutes int,
  created_at timestamptz, cost_usd_micros bigint, credits_captured int, generations int, failed_generations int,
  validation_repairs int, cache_hit_ratio float8, total_latency_ms bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.pipeline_id, e.workspace_id, e.plan_key, e.model_tier, e.status, e.minutes, e.created_at, e.cost_usd_micros,
         e.credits_captured, e.generations, e.failed_generations, e.validation_repairs, e.cache_hit_ratio, e.total_latency_ms
  from private.v_pipeline_economics e
  where e.created_at >= p_since
  order by e.created_at desc
  limit least(greatest(p_limit, 1), 1000)
$$;

-- Coût par minute de vidéo : le coût d'un pipeline suit sa durée. La médiane de chaque formule est
-- prise sur les pipelines terminés depuis `p_baseline_since` ; sans `p_min_sample` pipelines, pas
-- de médiane fiable, pas d'alerte.
create or replace function public.cost_outliers(p_since timestamptz, p_baseline_since timestamptz, p_factor numeric default 3, p_min_sample int default 5)
returns table (pipeline_id uuid, workspace_id uuid, model_tier text, cost_usd_micros bigint, cost_per_minute numeric, median_per_minute numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with finished as (
    select e.*, e.cost_usd_micros::numeric / greatest(e.minutes, 1) as per_minute
    from private.v_pipeline_economics e
    where e.status in ('completed', 'partial', 'failed') and e.cost_usd_micros > 0
  ),
  medians as (
    select f.model_tier, percentile_cont(0.5) within group (order by f.per_minute)::numeric as median, count(*) as sample
    from finished f
    where f.created_at >= p_baseline_since
    group by f.model_tier
  )
  select f.pipeline_id, f.workspace_id, f.model_tier, f.cost_usd_micros, round(f.per_minute), round(m.median)
  from finished f
  join medians m on m.model_tier = f.model_tier and m.sample >= p_min_sample
  where f.created_at >= p_since and f.per_minute > p_factor * m.median
  order by f.per_minute desc
$$;

create or replace function public.generation_failures(p_since timestamptz)
returns table (finished int, failed int)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int, (count(*) filter (where g.status = 'failed'))::int
  from public.generations g
  where g.finished_at >= p_since and g.status in ('succeeded', 'failed')
$$;

-- Mêmes critères que sweep_stale_reservations (0012), sans rien libérer.
create or replace function public.stale_reservations(p_idle interval default '30 minutes')
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select (
    select count(*) from public.pipelines p
    where p.status in ('queued', 'running')
      and greatest(
        p.created_at,
        (select max(greatest(g.created_at, g.started_at, g.finished_at)) from public.generations g where g.pipeline_id = p.id)
      ) < now() - p_idle
  )::int + (
    select count(*) from public.credit_ledger r
    where r.kind = 'reserve' and r.idempotency_key like 'reserve:regen:%'
      and private.regeneration_remaining(substr(r.idempotency_key, length('reserve:') + 1)) > 0
      and greatest(
        r.created_at,
        (select max(greatest(g.created_at, g.started_at, g.finished_at)) from public.generations g
         where g.idempotency_key = substr(r.idempotency_key, length('reserve:') + 1))
      ) < now() - p_idle
      and not exists (
        select 1 from public.generations g
        where g.idempotency_key = substr(r.idempotency_key, length('reserve:') + 1) and g.status = 'succeeded'
      )
  )::int
$$;

revoke all on private.v_pipeline_economics from public, anon, authenticated;
revoke all on function public.pipeline_economics, public.cost_outliers, public.generation_failures, public.stale_reservations
  from public, anon, authenticated;
grant execute on function public.pipeline_economics, public.cost_outliers, public.generation_failures, public.stale_reservations
  to service_role;
