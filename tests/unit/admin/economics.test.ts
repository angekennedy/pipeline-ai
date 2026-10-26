import { InngestTestEngine } from "@inngest/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { checkAlerts, eurCentsPerCredit, pipelineEconomics, reportAlerts, totals, type Alert } from "@/lib/admin/economics";
import { adminEmails, isPlatformAdmin } from "@/lib/auth/admin";
import { createMonitorEconomicsFunction } from "@/lib/jobs/functions/monitor-economics";
import type { Database } from "@/lib/supabase/database.types";

// Les agrégats (vue, médiane, taux d'échec) sont testés en base : tests/integration/economics.test.ts.

const row = (fields: Partial<Database["public"]["Functions"]["pipeline_economics"]["Returns"][number]> = {}) => ({
  pipeline_id: "4d1f7c3e-2b6a-4f8e-9c0d-1a2b3c4d5e6f",
  workspace_id: "ws-1",
  plan_key: "creator",
  model_tier: "standard",
  status: "completed" as const,
  minutes: 8,
  created_at: "2026-10-26T08:00:00.000Z",
  cost_usd_micros: 250_000, // 0,25 $
  credits_captured: 18,
  generations: 5,
  failed_generations: 0,
  validation_repairs: 1,
  cache_hit_ratio: 0.62,
  total_latency_ms: 90_000,
  ...fields,
});

describe("prix du crédit et marge", () => {
  it("vaut l'abonnement divisé par ses crédits, 0 pour Free ou un plan inconnu", () => {
    expect(eurCentsPerCredit("creator")).toBeCloseTo(4.75); // 19 € / 400
    expect(eurCentsPerCredit("studio")).toBeCloseTo(2.98); // 149 € / 5000
    expect(eurCentsPerCredit("free")).toBe(0);
    expect(eurCentsPerCredit("legacy")).toBe(0);
  });

  it("calcule coût en euros, chiffre d'affaires et marge d'un pipeline", () => {
    const economics = pipelineEconomics(row(), 0.9);
    expect(economics.costUsd).toBe(0.25);
    expect(economics.costEur).toBeCloseTo(0.225);
    expect(economics.revenueEur).toBeCloseTo(0.855); // 18 × 4,75 c
    expect(economics.marginEur).toBeCloseTo(0.63);
    expect(economics.marginRate).toBeCloseTo(0.737, 3);
    expect(economics).toMatchObject({ credits: 18, tier: "standard", planKey: "creator", cacheHitRatio: 0.62 });
  });

  it("donne une marge négative sans taux pour un pipeline Free", () => {
    const economics = pipelineEconomics(row({ plan_key: "free" }), 1);
    expect(economics.revenueEur).toBe(0);
    expect(economics.marginEur).toBeCloseTo(-0.25);
    expect(economics.marginRate).toBeNull();
  });

  it("additionne les pipelines de la période", () => {
    const rows = [pipelineEconomics(row(), 1), pipelineEconomics(row({ plan_key: "free", credits_captured: 10, cost_usd_micros: 100_000 }), 1)];
    const sum = totals(rows);
    expect(sum).toMatchObject({ pipelines: 2, credits: 28 });
    expect(sum.costEur).toBeCloseTo(0.35);
    expect(sum.revenueEur).toBeCloseTo(0.855);
    expect(sum.marginEur).toBeCloseTo(0.505);
    expect(totals([]).marginRate).toBeNull();
  });
});

type Responses = Record<string, { data: unknown; error: { message: string; code: string } | null }>;
const db = (responses: Responses) => {
  const rpc = vi.fn(async (name: string) => responses[name]!);
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
};
const ok = (data: unknown) => ({ data, error: null });

describe("checkAlerts", () => {
  const NOW = new Date("2026-10-26T12:00:00.000Z");

  it("interroge la base sur les 15 dernières minutes, la médiane sur 7 jours", async () => {
    const { client, rpc } = db({ cost_outliers: ok([]), generation_failures: ok([{ finished: 0, failed: 0 }]), stale_reservations: ok(0) });
    expect(await checkAlerts(client, NOW)).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("cost_outliers", { p_since: "2026-10-26T11:45:00.000Z", p_baseline_since: "2026-10-19T12:00:00.000Z", p_factor: 3, p_min_sample: 5 });
    expect(rpc).toHaveBeenCalledWith("generation_failures", { p_since: "2026-10-26T11:45:00.000Z" });
    expect(rpc).toHaveBeenCalledWith("stale_reservations", { p_idle: "1 hour" });
  });

  it("signale un coût hors norme, un taux d'échec au-delà de 5 % et des réservations non libérées", async () => {
    const { client } = db({
      cost_outliers: ok([{ pipeline_id: "p1", workspace_id: "ws-1", model_tier: "premium", cost_usd_micros: 9_000_000, cost_per_minute: 900_000, median_per_minute: 200_000 }]),
      generation_failures: ok([{ finished: 40, failed: 3 }]),
      stale_reservations: ok(2),
    });
    expect(await checkAlerts(client, NOW)).toEqual([
      { kind: "costOutlier", pipelineId: "p1", workspaceId: "ws-1", tier: "premium", costPerMinuteUsd: 0.9, medianPerMinuteUsd: 0.2 },
      { kind: "failureRate", failed: 3, finished: 40, rate: 0.075 },
      { kind: "staleReservations", count: 2 },
    ]);
  });

  it("ne juge pas un taux d'échec sur moins de 20 générations, ni à 5 % tout juste", async () => {
    for (const failures of [{ finished: 10, failed: 5 }, { finished: 40, failed: 2 }]) {
      const { client } = db({ cost_outliers: ok([]), generation_failures: ok([failures]), stale_reservations: ok(0) });
      expect(await checkAlerts(client, NOW)).toEqual([]);
    }
  });

  it("laisse remonter une erreur de la base", async () => {
    const { client } = db({ cost_outliers: ok([]), generation_failures: { data: null, error: { message: "boom", code: "XX000" } }, stale_reservations: ok(0) });
    await expect(checkAlerts(client, NOW)).rejects.toMatchObject({ message: "Alertes : boom", code: "XX000" });
  });
});

describe("reportAlerts et la fonction monitor-economics", () => {
  const alerts: Alert[] = [
    { kind: "costOutlier", pipelineId: "p1", workspaceId: "ws-1", tier: "standard", costPerMinuteUsd: 0.1, medianPerMinuteUsd: 0.02 },
    { kind: "staleReservations", count: 1 },
  ];

  it("envoie une alerte Sentry par type, regroupée par pipeline pour les coûts", () => {
    const capture = vi.fn();
    reportAlerts(alerts, capture);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenNthCalledWith(1, "Alerte économie : costOutlier", expect.objectContaining({ level: "warning", fingerprint: ["economics", "costOutlier", "p1"] }));
    expect(capture).toHaveBeenNthCalledWith(2, "Alerte économie : staleReservations", expect.objectContaining({ level: "error", fingerprint: ["economics", "staleReservations", "all"] }));
  });

  it("vérifie toutes les 15 min et ne rapporte que s'il y a des alertes", async () => {
    const report = vi.fn();
    const run = async (found: Alert[]) =>
      (await new InngestTestEngine({ function: createMonitorEconomicsFunction({ check: async () => found, report }), events: [{ name: "inngest/scheduled.timer", data: {} }] }).execute())
        .result;
    expect(await run([])).toEqual({ alerts: [] });
    expect(report).not.toHaveBeenCalled();
    expect(await run(alerts)).toEqual({ alerts: ["costOutlier", "staleReservations"] });
    expect(report).toHaveBeenCalledOnce();
    expect(createMonitorEconomicsFunction({ check: async () => [], report }).opts.triggers).toEqual([{ cron: "*/15 * * * *" }]);
  });
});

describe("administrateurs de la plateforme", () => {
  it("lit ADMIN_EMAILS sans tenir compte des espaces ni de la casse ; personne sans variable", () => {
    expect(adminEmails(" Ops@Pipeline.test, ,ada@pipeline.test ")).toEqual(new Set(["ops@pipeline.test", "ada@pipeline.test"]));
    expect(isPlatformAdmin("OPS@pipeline.test", "ops@pipeline.test")).toBe(true);
    expect(isPlatformAdmin("user@test.local", "ops@pipeline.test")).toBe(false);
    expect(isPlatformAdmin(null, "ops@pipeline.test")).toBe(false);
    expect(isPlatformAdmin("ops@pipeline.test", "")).toBe(false);
  });
});
