import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScriptSchema, type AssetType, type Brief } from "@/lib/ai/schemas";
import { getCreditSummary } from "@/lib/billing/balance";
import { InsufficientCreditsError, createPipelineWithReservation, releaseRegeneration, reserveRegeneration, sweepStaleReservations } from "@/lib/billing/reservation";
import { generateAsset } from "@/lib/pipeline/generate-asset";
import { loadPipelineView } from "@/lib/pipeline/load-view";
import { registry } from "@/lib/pipeline/registry";
import { runPipelineSteps, type StepRunner } from "@/lib/pipeline/run-pipeline";
import { applyScriptForm, sceneFieldName } from "@/lib/pipeline/script-form";
import { editAsset } from "@/lib/pipeline/versions";
import { SupabasePipelineStore } from "@/lib/supabase/pipeline-store";
import { validBrief } from "../fixtures/assets";
import { fakeOpenAI } from "./fake-openai";
import { admin, cleanup, createUser, unwrap, type TestUser } from "./helpers";

// Éditeur du script et régénération (tâche 4.2) : la version éditée est versionnée, puis reprise par la
// régénération des dérivés ; chaque régénération est réservée, capturée ou libérée (migration 0012).

const store = new SupabasePipelineStore(admin);
const step: StepRunner = { run: (_id, fn) => fn() };
const brief = validBrief as Brief;
const EDITED = "Narration réécrite à la main : la rampe en spirale est enfin expliquée, pierre par pierre.";

let a: TestUser;
let ws: string;
let pipelineId: string;

const balance = async () => getCreditSummary(admin, ws);
const key = () => `regen:${randomUUID()}`;
const credits = (type: AssetType) => registry[type].credits(brief, "standard");

beforeAll(async () => {
  a = await createUser("regen");
  ws = unwrap(await admin.from("workspace_members").select("workspace_id").eq("user_id", a.id).single()).workspace_id;
  ({ pipelineId } = await createPipelineWithReservation(admin, { workspaceId: ws, userId: a.id, brief, tier: "standard", idempotencyKey: randomUUID() }));
  const client = fakeOpenAI();
  await runPipelineSteps(pipelineId, { step, store, generate: (type) => generateAsset(pipelineId, type, { store, client }) });
});
afterAll(cleanup);

describe("script édité puis dérivés régénérés", () => {
  it("versionne l'édition, rend les dérivés obsolètes, puis les régénère à partir du script édité", async () => {
    // Édition : comme la Server Action saveScript.
    const current = ScriptSchema.parse((await store.getCurrentVersion(pipelineId, "script"))!.content);
    const form = new FormData();
    form.set(sceneFieldName(2, "narration"), EDITED);
    await editAsset(pipelineId, "script", applyScriptForm(current, form), { store, userId: a.id });

    let view = (await loadPipelineView(a.client, ws, pipelineId))!;
    expect(view.assets.script.versions.map((v) => v.source)).toEqual(["user_edit", "ai"]);
    expect(view.assets.script.content!.scenes[1]!.narration).toBe(EDITED);
    expect(Object.entries(view.assets).filter(([, asset]) => asset.stale).map(([type]) => type)).toEqual(["titles", "seo", "voiceover", "thumbnails"]);

    // Régénération des dérivés : réservation par asset, puis génération dans l'ordre du DAG.
    const before = await balance();
    const requests: Array<{ type: AssetType; body: string }> = [];
    const client = fakeOpenAI([], requests);
    const derived = ["titles", "seo", "voiceover", "thumbnails"] as const;
    const keys = Object.fromEntries(derived.map((type) => [type, key()])) as Record<(typeof derived)[number], string>;
    for (const type of derived) {
      expect(await reserveRegeneration(admin, { workspaceId: ws, userId: a.id, pipelineId, key: keys[type], credits: credits(type), tier: "standard" })).toBe(true);
    }
    const total = derived.reduce((sum, type) => sum + credits(type), 0);
    expect(await balance()).toMatchObject({ balance: before.balance, reserved: before.reserved + total });

    for (const type of derived) await generateAsset(pipelineId, type, { store, client, regeneration: { key: keys[type] } });

    // Le modèle a lu le script édité, pour chaque dérivé.
    expect(requests.map((r) => r.type)).toEqual(derived);
    for (const request of requests) expect(request.body).toContain("la rampe en spirale est enfin expliquée");

    view = (await loadPipelineView(a.client, ws, pipelineId))!;
    expect(Object.values(view.assets).some((asset) => asset.stale)).toBe(false);
    expect(view.assets.titles.versions.map((v) => v.source)).toEqual(["ai_regen", "ai"]);
    expect(await balance()).toMatchObject({ balance: before.balance - total, reserved: before.reserved }); // tout capturé
    for (const type of derived) await releaseRegeneration(admin, keys[type]); // sans effet : rien ne reste
    expect((await balance()).balance).toBe(before.balance - total);
  });
});

describe("facturation d'une régénération", () => {
  it("libère toute la réservation d'une régénération en échec, et ne capture plus rien ensuite", async () => {
    const before = await balance();
    const regen = key();
    await reserveRegeneration(admin, { workspaceId: ws, userId: a.id, pipelineId, key: regen, credits: credits("seo"), tier: "standard" });
    await expect(generateAsset(pipelineId, "seo", { store, client: fakeOpenAI(["seo"]), regeneration: { key: regen } })).rejects.toThrow();
    expect(await releaseRegeneration(admin, regen)).toBe(credits("seo"));
    expect(await releaseRegeneration(admin, regen)).toBe(0); // idempotente
    expect(await balance()).toEqual(before);

    // Une réussite tardive, après libération, n'est pas facturée.
    await generateAsset(pipelineId, "seo", { store, client: fakeOpenAI(), regeneration: { key: regen } });
    expect(await balance()).toEqual(before);
  });

  it("ne réserve qu'une fois par clé, et refuse un solde insuffisant sans rien écrire", async () => {
    const before = await balance();
    const regen = key();
    const input = { workspaceId: ws, userId: a.id, pipelineId, key: regen, credits: 3, tier: "standard" as const };
    expect(await reserveRegeneration(admin, input)).toBe(true);
    expect(await reserveRegeneration(admin, input)).toBe(false);
    expect((await balance()).reserved).toBe(before.reserved + 3);
    await releaseRegeneration(admin, regen);

    const error = await reserveRegeneration(admin, { ...input, key: key(), credits: before.available + 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InsufficientCreditsError);
    expect(await balance()).toEqual(before);
  });

  it("refuse un lecteur et un pipeline d'un autre workspace", async () => {
    const viewer = await createUser("regen-viewer");
    unwrap(await admin.from("workspace_members").insert({ workspace_id: ws, user_id: viewer.id, role: "viewer" }).select());
    await expect(reserveRegeneration(admin, { workspaceId: ws, userId: viewer.id, pipelineId, key: key(), credits: 1, tier: "standard" })).rejects.toThrow(/FORBIDDEN/);

    const other = await createUser("regen-other");
    const otherWs = unwrap(await admin.from("workspace_members").select("workspace_id").eq("user_id", other.id).eq("role", "owner").single()).workspace_id;
    await expect(reserveRegeneration(admin, { workspaceId: otherWs, userId: other.id, pipelineId, key: key(), credits: 1, tier: "standard" })).rejects.toThrow(
      /PIPELINE_NOT_FOUND/,
    );
  });

  it("libère par le balayage une régénération restée sans activité", async () => {
    const before = await balance();
    const regen = key();
    await reserveRegeneration(admin, { workspaceId: ws, userId: a.id, pipelineId, key: regen, credits: 2, tier: "standard" });
    // Réservation datée d'il y a une heure, jamais prise en charge par Inngest.
    unwrap(await admin.from("credit_ledger").update({ created_at: new Date(Date.now() - 3_600_000).toISOString() }).eq("idempotency_key", `reserve:${regen}`).select());
    expect(await sweepStaleReservations(admin)).toBeGreaterThanOrEqual(1);
    expect(await balance()).toEqual(before);
  });
});
