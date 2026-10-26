import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Brief } from "@/lib/ai/schemas";
import { createPipelineWithReservation } from "@/lib/billing/reservation";
import { generateAsset } from "@/lib/pipeline/generate-asset";
import { loadPipelineView } from "@/lib/pipeline/load-view";
import { runPipelineSteps, type StepRunner } from "@/lib/pipeline/run-pipeline";
import { SupabasePipelineStore } from "@/lib/supabase/pipeline-store";
import { findMembership } from "@/lib/workspaces/access";
import { validBrief } from "../fixtures/assets";
import { fakeAnthropic } from "./fake-anthropic";
import { admin, cleanup, createUser, unwrap, type TestUser } from "./helpers";

// Routes /w/[workspaceSlug] (tâche 2.3) : le layout et la page d'un pipeline s'appuient sur
// findMembership et loadPipelineView, lus avec le client de l'utilisateur. Un résultat null donne le
// 404. Le refus du canal Realtime d'un pipeline de A est vérifié dans rls.test.ts.

const store = new SupabasePipelineStore(admin);
const step: StepRunner = { run: (_id, fn) => fn() };

let a: TestUser;
let b: TestUser;
let wsA: { id: string; slug: string };
let wsB: { id: string; slug: string };
let pipelineA: string;

async function personal(user: TestUser) {
  const { workspace_id } = unwrap(await admin.from("workspace_members").select("workspace_id").eq("user_id", user.id).single());
  return unwrap(await admin.from("workspaces").select("id, slug").eq("id", workspace_id).single());
}

beforeAll(async () => {
  [a, b] = await Promise.all([createUser("ws-a"), createUser("ws-b")]);
  [wsA, wsB] = await Promise.all([personal(a), personal(b)]);
  ({ pipelineId: pipelineA } = await createPipelineWithReservation(admin, {
    workspaceId: wsA.id,
    userId: a.id,
    brief: validBrief as Brief,
    tier: "standard",
    idempotencyKey: randomUUID(),
  }));
  // Génération réelle, Anthropic simulé : les titres sont refusés, les miniatures qui en dépendent sautées.
  const client = fakeAnthropic(["titles"]);
  await runPipelineSteps(pipelineA, { step, store, generate: (type) => generateAsset(pipelineA, type, { store, client }) });
});
afterAll(cleanup);

describe("appartenance au workspace", () => {
  it("donne au membre son rôle et le solde du workspace", async () => {
    expect(await findMembership(a.client, a.id, wsA.slug)).toEqual({
      workspace: { id: wsA.id, slug: wsA.slug, name: expect.stringMatching(/^Espace de /) },
      role: "owner",
      credits: { planKey: "free", balance: 14, reserved: 0, available: 14 }, // 18 réservés, 16 débités : titres et miniatures (1 + 1) rendus
    });
  });

  it("ne révèle rien du workspace de A à B, même en se faisant passer pour A", async () => {
    expect(await findMembership(b.client, b.id, wsA.slug)).toBeNull();
    expect(await findMembership(b.client, a.id, wsA.slug)).toBeNull(); // la RLS suit le jeton, pas l'id passé
    expect(await findMembership(b.client, b.id, "inexistant-00000000")).toBeNull();
  });
});

describe("page d'un pipeline", () => {
  it("relit en base l'état du pipeline de A : assets prêts, en échec avec un message clair, sautés", async () => {
    const view = await loadPipelineView(a.client, wsA.id, pipelineA);
    expect(view).toMatchObject({ id: pipelineA, status: "partial", tier: "standard", brief: validBrief, staleCredits: 0 });
    expect(Object.fromEntries(Object.entries(view!.assets).map(([type, asset]) => [type, asset.status]))).toEqual({
      script: "ready",
      titles: "failed",
      seo: "ready",
      voiceover: "ready",
      thumbnails: "skipped",
    });
    expect(view!.assets.script.content?.scenes.length).toBeGreaterThan(0);
    expect(view!.assets.script.versions).toEqual([{ id: expect.any(String), version: 1, source: "ai", createdAt: expect.any(String) }]);
    expect(view!.assets.titles.error).toEqual({ code: "CONTENT_REFUSED", message: expect.stringMatching(/^Le modèle a refusé/) });
  });

  it("donne null (404) à B, depuis son propre workspace comme depuis celui de A", async () => {
    expect(await loadPipelineView(b.client, wsA.id, pipelineA)).toBeNull();
    expect(await loadPipelineView(b.client, wsB.id, pipelineA)).toBeNull();
  });

  it("donne null quand le pipeline n'appartient pas au workspace de l'URL", async () => {
    expect(await loadPipelineView(admin, wsB.id, pipelineA)).toBeNull(); // même sans RLS
  });

  it("signale les dérivés obsolètes après une retouche du script, avec le coût de leur régénération", async () => {
    const script = (await store.getCurrentVersion(pipelineA, "script"))!;
    await store.commitAssetVersion({
      pipelineId: pipelineA,
      assetType: "script",
      content: script.content,
      schemaVersion: "script@1",
      source: "user_edit",
      sourceVersions: {},
      restoredFrom: null,
      generation: null,
      createdBy: a.id,
    });
    const view = await loadPipelineView(a.client, wsA.id, pipelineA);
    expect(view!.assets.script.versions.map((v) => v.source)).toEqual(["user_edit", "ai"]);
    expect([view!.assets.seo.stale, view!.assets.voiceover.stale, view!.assets.script.stale]).toEqual([true, true, false]);
    expect(view!.staleCredits).toBe(2 + 2); // SEO 2, voix off 2 (8 min)
  });
});
