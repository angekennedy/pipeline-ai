import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenerationInProgressError, type GenerationTelemetry } from "@/lib/pipeline/store";
import { SupabasePipelineStore } from "@/lib/supabase/pipeline-store";
import { validBrief } from "../fixtures/assets";
import { admin, cleanup, createPipeline, createUser, createWorkspace, unwrap, type TestUser } from "./helpers";

const store = new SupabasePipelineStore(admin);

const telemetry: GenerationTelemetry = {
  model: "claude-sonnet-5-5",
  promptVersion: "script@2",
  usage: { inputTokens: 1200, outputTokens: 3400, cacheReadTokens: 800, cacheCreationTokens: 0 },
  costUsdMicros: 54_000,
  latencyMs: 61_000,
  repairs: 1,
  attempts: 2,
};

let owner: TestUser;
let workspaceId: string;
let pipelineId: string;

beforeAll(async () => {
  owner = await createUser("store");
  workspaceId = await createWorkspace(owner, "store");
  pipelineId = await createPipeline(workspaceId, owner.id);
});
afterAll(cleanup);

const generation = (key: string, type: "script" | "titles" = "script") =>
  store.upsertGeneration({ pipelineId, assetType: type, idempotencyKey: `${key}:${pipelineId}`, credits: 4 });

describe("SupabasePipelineStore", () => {
  it("lit le pipeline et son brief", async () => {
    const pipeline = await store.getPipeline(pipelineId);
    expect(pipeline).toEqual({ id: pipelineId, workspaceId, brief: validBrief, channel: null, tier: "standard" });
    await expect(store.getPipeline("00000000-0000-0000-0000-000000000000")).rejects.toThrow("Pipeline inconnu");
  });

  it("renvoie la même génération pour la même clé", async () => {
    const first = await generation("idem");
    const second = await generation("idem");
    expect(second).toEqual(first);
    expect(first).toMatchObject({ status: "queued", attempt: 0, versionId: null });
  });

  it("refuse une seconde prise tant que le bail court, et la rend après un échec", async () => {
    const { id } = await generation("claim", "titles");
    await store.markRunning(id, 1);
    await expect(store.markRunning(id, 1)).rejects.toBeInstanceOf(GenerationInProgressError);

    const asset = unwrap(await admin.from("pipeline_assets").select("status").eq("pipeline_id", pipelineId).eq("type", "titles").single());
    expect(asset.status).toBe("running");

    await store.markFailed(id, { code: "PROVIDER_ERROR", message: "503", costUsdMicros: null });
    const failed = unwrap(await admin.from("pipeline_assets").select("status").eq("pipeline_id", pipelineId).eq("type", "titles").single());
    expect(failed.status).toBe("failed"); // aucune version encore : l'asset passe en échec
    await expect(store.markRunning(id, 2)).resolves.toBeUndefined();
  });

  it("enregistre une version, la télémétrie et le pointeur courant en une fois", async () => {
    const { id } = await generation("commit");
    await store.markRunning(id, 1);
    const versionId = await store.commitAssetVersion({
      pipelineId,
      assetType: "script",
      content: { hook: "Accroche" },
      schemaVersion: "script@1",
      source: "ai",
      sourceVersions: {},
      restoredFrom: null,
      generation: { id, telemetry },
      createdBy: null,
    });

    const current = await store.getCurrentVersion(pipelineId, "script");
    expect(current).toMatchObject({ id: versionId, version: 1, source: "ai", content: { hook: "Accroche" }, sourceVersions: {}, restoredFrom: null });
    expect(Date.parse(current!.createdAt)).not.toBeNaN();

    // Rejouée après le succès, la génération renvoie la version : pas de second appel au modèle.
    expect(await generation("commit")).toMatchObject({ status: "succeeded", versionId });
    const row = unwrap(await admin.from("generations").select("*").eq("id", id).single());
    expect(row).toMatchObject({
      model: "claude-sonnet-5-5",
      prompt_version: "script@2",
      input_tokens: 1200,
      output_tokens: 3400,
      cache_read_tokens: 800,
      cache_creation_tokens: 0,
      cost_usd_micros: 54_000,
      latency_ms: 61_000,
      validation_repairs: 1,
      api_calls: 2,
    });
    expect(row.finished_at).not.toBeNull();
    await expect(store.markRunning(id, 2)).rejects.toBeInstanceOf(GenerationInProgressError); // déjà réussie
  });

  it("numérote les versions, les liste de la plus récente à la plus ancienne et garde la courante après un échec", async () => {
    const first = (await store.listVersions(pipelineId, "script")).at(-1)!;
    const edited = await store.commitAssetVersion({
      pipelineId,
      assetType: "script",
      content: { hook: "Accroche retouchée" },
      schemaVersion: "script@1",
      source: "user_edit",
      sourceVersions: { script: first.id },
      restoredFrom: null,
      generation: null,
      createdBy: owner.id,
    });
    const restored = await store.commitAssetVersion({
      pipelineId,
      assetType: "script",
      content: first.content,
      schemaVersion: "script@1",
      source: "restore",
      sourceVersions: {},
      restoredFrom: first.id,
      generation: null,
      createdBy: owner.id,
    });

    const versions = await store.listVersions(pipelineId, "script");
    expect(versions.map((v) => [v.version, v.source])).toEqual([
      [3, "restore"],
      [2, "user_edit"],
      [1, "ai"],
    ]);
    expect(versions[1]?.sourceVersions).toEqual({ script: first.id });
    expect(await store.getVersion(restored)).toMatchObject({ pipelineId, assetType: "script", restoredFrom: first.id, version: 3 });
    expect(await store.getVersion(edited)).toMatchObject({ content: { hook: "Accroche retouchée" } });
    expect(await store.listVersions(pipelineId, "seo")).toEqual([]);
    expect(await store.getCurrentVersion(pipelineId, "seo")).toBeNull();

    // Une régénération ratée laisse la version courante et l'asset prêt.
    const regen = await store.upsertGeneration({ pipelineId, assetType: "script", idempotencyKey: `regen:${pipelineId}`, credits: 4, userFeedback: "Plus court" });
    await store.markRunning(regen.id, 1);
    await store.markFailed(regen.id, { code: "SCHEMA_INVALID", message: "x".repeat(3000), costUsdMicros: 1200 });
    expect((await store.getCurrentVersion(pipelineId, "script"))?.id).toBe(restored);
    const asset = unwrap(await admin.from("pipeline_assets").select("status").eq("pipeline_id", pipelineId).eq("type", "script").single());
    expect(asset.status).toBe("ready");
    const failed = unwrap(await admin.from("generations").select("status, error_message, cost_usd_micros, user_feedback").eq("id", regen.id).single());
    expect(failed).toMatchObject({ status: "failed", cost_usd_micros: 1200, user_feedback: "Plus court" });
    expect(failed.error_message).toHaveLength(2000);
  });

  it("pose le statut du pipeline et la date de fin pour un statut terminal", async () => {
    await store.setPipelineStatus(pipelineId, "running");
    let row = unwrap(await admin.from("pipelines").select("status, completed_at").eq("id", pipelineId).single());
    expect(row).toEqual({ status: "running", completed_at: null });

    await store.setPipelineStatus(pipelineId, "partial");
    row = unwrap(await admin.from("pipelines").select("status, completed_at").eq("id", pipelineId).single());
    expect(row.status).toBe("partial");
    expect(row.completed_at).not.toBeNull();
  });
});
