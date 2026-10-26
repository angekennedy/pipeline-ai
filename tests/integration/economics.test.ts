import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEconomics } from "@/lib/admin/economics";
import { validBrief } from "../fixtures/assets";
import { admin, anon, cleanup, createUser, createWorkspace, unwrap, type TestUser } from "./helpers";

// Coût et marge par pipeline, alertes (migration 0014), contre la vraie base. Données datées de 2099 :
// les agrégats « depuis 2099 » ne comptent que celles de ce fichier.

afterAll(cleanup);

const FUTURE = "2099-03-01T00:00:00.000Z";
const at = (minutes: number) => new Date(Date.parse(FUTURE) + minutes * 60_000).toISOString();

let owner: TestUser;
let workspaceId: string;

beforeAll(async () => {
  owner = await createUser("economics-owner");
  workspaceId = await createWorkspace(owner, "economics");
  unwrap(await admin.from("workspaces").update({ plan_key: "creator" }).eq("id", workspaceId).select());
});

type Generation = { cost: number | null; status: "succeeded" | "failed"; credits?: number; finishedAt?: string; cache?: [number, number] };
type PipelineFields = { minutes?: number; tier?: "standard" | "premium"; status?: "queued" | "running" | "completed"; createdAt?: string };

async function pipelineWith({ minutes = 8, tier = "standard", status = "completed", createdAt = at(0) }: PipelineFields, generations: Generation[]): Promise<string> {
  const pipeline = unwrap(
    await admin
      .from("pipelines")
      .insert({ workspace_id: workspaceId, created_by: owner.id, brief: { ...validBrief, durationMinutes: minutes }, model_tier: tier, status, idempotency_key: randomUUID(), created_at: createdAt })
      .select("id")
      .single(),
  );
  for (const generation of generations) {
    const key = `pipe:${pipeline.id}:${randomUUID().slice(0, 8)}`;
    const row = unwrap(
      await admin
        .from("generations")
        .insert({
          workspace_id: workspaceId,
          pipeline_id: pipeline.id,
          asset_type: "script",
          idempotency_key: key,
          credits: generation.credits ?? 1,
          status: generation.status,
          cost_usd_micros: generation.cost,
          input_tokens: generation.cache?.[0] ?? 0,
          cache_read_tokens: generation.cache?.[1] ?? 0,
          cache_creation_tokens: 0,
          latency_ms: 1000,
          created_at: createdAt,
          finished_at: generation.finishedAt ?? createdAt,
        })
        .select("id")
        .single(),
    );
    // Débit réel d'une génération réussie : sa capture dans le registre.
    if (generation.status === "succeeded" && generation.credits) {
      unwrap(
        await admin
          .from("credit_ledger")
          .insert({ workspace_id: workspaceId, kind: "capture", amount: generation.credits, balance_after: 0, reserved_after: 0, idempotency_key: `capture:${key}`, pipeline_id: pipeline.id, generation_id: row.id })
          .select(),
      );
    }
  }
  return pipeline.id;
}

describe("pipeline_economics", () => {
  it("agrège coût, crédits capturés, cache et échecs par pipeline, régénérations comprises", async () => {
    const id = await pipelineWith({ createdAt: at(1) }, [
      { cost: 200_000, status: "succeeded", credits: 14, cache: [300, 700] },
      { cost: 50_000, status: "failed", cache: [100, 0] }, // facturé par l'API, rien débité
      { cost: 30_000, status: "succeeded", credits: 2, cache: [0, 900] }, // régénération
    ]);
    const rows = unwrap(await admin.rpc("pipeline_economics", { p_since: FUTURE }));
    const row = rows.find((r) => r.pipeline_id === id)!;
    expect(row).toMatchObject({
      workspace_id: workspaceId,
      plan_key: "creator",
      model_tier: "standard",
      status: "completed",
      minutes: 8,
      cost_usd_micros: 280_000,
      credits_captured: 16,
      generations: 3,
      failed_generations: 1,
      total_latency_ms: 3000,
    });
    expect(row.cache_hit_ratio).toBeCloseTo(1600 / 2000);

    // Côté application : 16 crédits Creator (4,75 c) = 0,76 € ; coût 0,28 $.
    const economics = (await loadEconomics(admin, new Date(FUTURE))).find((e) => e.pipelineId === id)!;
    expect(economics.revenueEur).toBeCloseTo(0.76);
    expect(economics.costUsd).toBeCloseTo(0.28);
  });

  it("garde un pipeline sans génération, à coût nul, et n'est lisible qu'en service role", async () => {
    const id = await pipelineWith({ status: "queued", createdAt: at(2) }, []);
    const row = unwrap(await admin.rpc("pipeline_economics", { p_since: FUTURE })).find((r) => r.pipeline_id === id);
    expect(row).toMatchObject({ cost_usd_micros: 0, credits_captured: 0, generations: 0, cache_hit_ratio: null });
    for (const client of [anon(), owner.client]) {
      const { error } = await client.rpc("pipeline_economics", { p_since: FUTURE });
      expect(error).toMatchObject({ code: "42501" });
    }
  });
});

describe("alertes", () => {
  it("repère un pipeline à plus de 3× le coût médian par minute de sa formule", async () => {
    // Base Premium : cinq pipelines à 0,10 $ par minute, de 4 à 12 min.
    for (const minutes of [4, 6, 8, 10, 12]) await pipelineWith({ tier: "premium", minutes, createdAt: at(10) }, [{ cost: minutes * 100_000, status: "succeeded" }]);
    const normal = await pipelineWith({ tier: "premium", minutes: 20, createdAt: at(20) }, [{ cost: 2_900_000, status: "succeeded" }]); // 1,45×
    const outlier = await pipelineWith({ tier: "premium", minutes: 5, createdAt: at(20) }, [{ cost: 1_600_000, status: "failed" }]); // 3,2×

    const found = unwrap(await admin.rpc("cost_outliers", { p_since: at(15), p_baseline_since: FUTURE, p_factor: 3, p_min_sample: 5 }));
    expect(found.map((r) => r.pipeline_id)).toEqual([outlier]);
    expect(found[0]).toMatchObject({ model_tier: "premium", cost_per_minute: 320_000, median_per_minute: 100_000 });
    expect(found.map((r) => r.pipeline_id)).not.toContain(normal);

    // Sans assez de pipelines dans la formule, pas de médiane fiable : aucune alerte.
    expect(unwrap(await admin.rpc("cost_outliers", { p_since: at(15), p_baseline_since: FUTURE, p_factor: 3, p_min_sample: 50 }))).toEqual([]);
  });

  it("compte les générations terminées et échouées depuis une date", async () => {
    await pipelineWith({ createdAt: at(30) }, [
      { cost: 1, status: "succeeded", finishedAt: at(31) },
      { cost: 1, status: "failed", finishedAt: at(32) },
      { cost: 1, status: "failed", finishedAt: at(33) },
      { cost: 1, status: "succeeded", finishedAt: at(29) }, // avant la fenêtre
    ]);
    expect(unwrap(await admin.rpc("generation_failures", { p_since: at(30) }))).toEqual([{ finished: 3, failed: 2 }]);
  });

  it("compte une réservation restée sans activité au-delà du délai, comme le balayage", async () => {
    const before = unwrap(await admin.rpc("stale_reservations", { p_idle: "1 hour" })) as number;
    await pipelineWith({ status: "running", createdAt: new Date(Date.now() - 2 * 3600_000).toISOString() }, []);
    await pipelineWith({ status: "running", createdAt: new Date(Date.now() - 10 * 60_000).toISOString() }, []); // encore actif
    expect(unwrap(await admin.rpc("stale_reservations", { p_idle: "1 hour" }))).toBe(before + 1);
  });
});
