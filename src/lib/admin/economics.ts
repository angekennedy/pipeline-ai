import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS, PLAN_KEYS, type PlanKey } from "@/lib/billing/plans";
import { serverEnv } from "@/lib/env/server";
import type { Database } from "@/lib/supabase/database.types";

// Coût et marge par pipeline, alertes (tâche 4.6, ARCHITECTURE « Observabilité »). Les agrégats
// viennent de la base (migration 0014) ; le chiffre d'affaires est estimé ici, au prix du crédit
// dans le plan actuel du workspace : abonnement mensuel divisé par ses crédits. Free vaut 0 : ses
// pipelines sont un coût d'acquisition. Les packs, plus chers au crédit, ne sont pas distingués :
// l'estimation est prudente pour les workspaces qui en achètent.

const MICROS = 1_000_000;

export const eurCentsPerCredit = (planKey: string): number => {
  const plan = PLAN_KEYS.includes(planKey as PlanKey) ? PLANS[planKey as PlanKey] : null;
  return plan && plan.credits > 0 ? plan.priceEurCents / plan.credits : 0;
};

type EconomicsRow = Database["public"]["Functions"]["pipeline_economics"]["Returns"][number];

export type PipelineEconomics = {
  pipelineId: string;
  workspaceId: string;
  planKey: string;
  tier: string;
  status: EconomicsRow["status"];
  minutes: number;
  createdAt: string;
  costUsd: number;
  costEur: number;
  credits: number;
  revenueEur: number;
  marginEur: number;
  marginRate: number | null; // null sans chiffre d'affaires (Free, ou rien débité)
  generations: number;
  failedGenerations: number;
  cacheHitRatio: number | null;
};

export function pipelineEconomics(row: EconomicsRow, usdToEur = serverEnv.USD_TO_EUR): PipelineEconomics {
  const costUsd = row.cost_usd_micros / MICROS;
  const costEur = costUsd * usdToEur;
  const revenueEur = (row.credits_captured * eurCentsPerCredit(row.plan_key)) / 100;
  const marginEur = revenueEur - costEur;
  return {
    pipelineId: row.pipeline_id,
    workspaceId: row.workspace_id,
    planKey: row.plan_key,
    tier: row.model_tier,
    status: row.status,
    minutes: row.minutes,
    createdAt: row.created_at,
    costUsd,
    costEur,
    credits: row.credits_captured,
    revenueEur,
    marginEur,
    marginRate: revenueEur > 0 ? marginEur / revenueEur : null,
    generations: row.generations,
    failedGenerations: row.failed_generations,
    cacheHitRatio: row.cache_hit_ratio,
  };
}

export type EconomicsTotals = { pipelines: number; costEur: number; revenueEur: number; marginEur: number; marginRate: number | null; credits: number };

export function totals(rows: PipelineEconomics[]): EconomicsTotals {
  const sum = (pick: (row: PipelineEconomics) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const revenueEur = sum((row) => row.revenueEur);
  const marginEur = sum((row) => row.marginEur);
  return { pipelines: rows.length, costEur: sum((row) => row.costEur), revenueEur, marginEur, marginRate: revenueEur > 0 ? marginEur / revenueEur : null, credits: sum((row) => row.credits) };
}

export async function loadEconomics(db: SupabaseClient<Database>, since: Date, limit = 200): Promise<PipelineEconomics[]> {
  const { data, error } = await db.rpc("pipeline_economics", { p_since: since.toISOString(), p_limit: limit });
  if (error) throw Object.assign(new Error(`Économie des pipelines : ${error.message}`), { code: error.code });
  return data.map((row) => pipelineEconomics(row));
}

// Seuils des alertes. Le taux d'échec n'est calculé qu'au-delà d'un échantillon minimal : deux échecs
// sur trois générations ne disent rien.
export const ALERT_RULES = {
  window: 15 * 60 * 1000, // fenêtre de surveillance (cron toutes les 15 min)
  costFactor: 3, // × le coût médian par minute de la formule
  baseline: 7 * 24 * 3600 * 1000, // médiane sur 7 jours
  minBaselineSample: 5,
  failureRate: 0.05,
  minFailureSample: 20,
  // Le balayage libère une réservation après 30 min sans activité, toutes les 15 min : au-delà d'une
  // heure, il ne fonctionne plus.
  staleIdle: "1 hour",
} as const;

export type Alert =
  | { kind: "costOutlier"; pipelineId: string; workspaceId: string; tier: string; costPerMinuteUsd: number; medianPerMinuteUsd: number }
  | { kind: "failureRate"; failed: number; finished: number; rate: number }
  | { kind: "staleReservations"; count: number };

export async function checkAlerts(db: SupabaseClient<Database>, now = new Date()): Promise<Alert[]> {
  const since = new Date(now.getTime() - ALERT_RULES.window).toISOString();
  const [outliers, failures, stale] = await Promise.all([
    db.rpc("cost_outliers", {
      p_since: since,
      p_baseline_since: new Date(now.getTime() - ALERT_RULES.baseline).toISOString(),
      p_factor: ALERT_RULES.costFactor,
      p_min_sample: ALERT_RULES.minBaselineSample,
    }),
    db.rpc("generation_failures", { p_since: since }),
    db.rpc("stale_reservations", { p_idle: ALERT_RULES.staleIdle }),
  ]);
  for (const result of [outliers, failures, stale]) {
    if (result.error) throw Object.assign(new Error(`Alertes : ${result.error.message}`), { code: result.error.code });
  }

  const alerts: Alert[] = (outliers.data ?? []).map((row) => ({
    kind: "costOutlier",
    pipelineId: row.pipeline_id,
    workspaceId: row.workspace_id,
    tier: row.model_tier,
    costPerMinuteUsd: row.cost_per_minute / MICROS,
    medianPerMinuteUsd: row.median_per_minute / MICROS,
  }));
  const { finished = 0, failed = 0 } = failures.data?.[0] ?? {};
  if (finished >= ALERT_RULES.minFailureSample && failed / finished > ALERT_RULES.failureRate) {
    alerts.push({ kind: "failureRate", failed, finished, rate: failed / finished });
  }
  if ((stale.data ?? 0) > 0) alerts.push({ kind: "staleReservations", count: stale.data! });
  return alerts;
}

// Une alerte Sentry par type (et par pipeline pour les coûts) : Sentry regroupe les répétitions.
export function reportAlerts(alerts: Alert[], capture: typeof Sentry.captureMessage = Sentry.captureMessage) {
  for (const alert of alerts) {
    // i18n-ignore : titre de l'alerte Sentry, jamais affiché aux utilisateurs.
    capture(`Alerte économie : ${alert.kind}`, {
      level: alert.kind === "costOutlier" ? "warning" : "error",
      tags: { alert: alert.kind },
      extra: alert,
      fingerprint: ["economics", alert.kind, alert.kind === "costOutlier" ? alert.pipelineId : "all"],
    });
  }
}
