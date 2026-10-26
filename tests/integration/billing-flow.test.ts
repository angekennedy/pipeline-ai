import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AssetType, Brief } from "@/lib/ai/schemas";
import { assetCredits, pipelineCredits } from "@/lib/billing/costs";
import { createPipelineWithReservation, sweepStaleReservations } from "@/lib/billing/reservation";
import { generateAsset } from "@/lib/pipeline/generate-asset";
import { runPipelineSteps, type StepRunner } from "@/lib/pipeline/run-pipeline";
import { SupabasePipelineStore } from "@/lib/supabase/pipeline-store";
import { validBrief } from "../fixtures/assets";
import { fakeAnthropic } from "./fake-anthropic";
import { admin, cleanup, createUser, createWorkspace, unwrap, withPg, type TestUser } from "./helpers";

// Cycle des crédits d'un pipeline (migration 0007, ARCHITECTURE §5.2), de bout en bout : vraie
// orchestration (runPipelineSteps, generateAsset) sur le vrai store Supabase. Seule l'API Anthropic
// est simulée, par un client dont le fetch renvoie les réponses streamées des mocks.

const brief = validBrief as Brief; // 8 min : 18 crédits en standard
const costs = assetCredits(brief, "standard");
const total = pipelineCredits(brief, "standard");
const store = new SupabasePipelineStore(admin);
const step: StepRunner = { run: (_id, fn) => fn() };

let owner: TestUser;

beforeAll(async () => {
  owner = await createUser("billing");
});
afterAll(cleanup);

async function newPipeline(balance = 100) {
  const workspaceId = await createWorkspace(owner, "billing");
  await withPg((pg) => pg.query("select private.credit_op($1, 'grant', $2, $3)", [workspaceId, balance, `grant:${workspaceId}`]));
  const { pipelineId } = await createPipelineWithReservation(admin, { workspaceId, userId: owner.id, brief, tier: "standard", idempotencyKey: randomUUID() });
  return { workspaceId, pipelineId };
}

const run = (pipelineId: string, refused: AssetType[] = []) => {
  const client = fakeAnthropic(refused);
  return runPipelineSteps(pipelineId, { step, store, generate: (type) => generateAsset(pipelineId, type, { store, client }) });
};

async function account(workspaceId: string) {
  return unwrap(await admin.from("credit_accounts").select("balance, reserved").eq("workspace_id", workspaceId).single());
}

// Écritures du registre de ce pipeline, l'id remplacé par P. Les dérivés partent en parallèle :
// l'ordre de leurs captures est libre, d'où le tri.
async function entries(pipelineId: string) {
  const rows = unwrap(await admin.from("credit_ledger").select("kind, amount, idempotency_key").eq("pipeline_id", pipelineId));
  return rows.map((r) => `${r.kind} ${r.amount} ${r.idempotency_key.replace(pipelineId, "P")}`).sort();
}

describe("capture et libération des crédits", () => {
  it("capture chaque asset dans la transaction de sa version : un pipeline complet consomme sa réservation", async () => {
    const { workspaceId, pipelineId } = await newPipeline();
    expect((await run(pipelineId)).status).toBe("completed");

    expect(await account(workspaceId)).toEqual({ balance: 100 - total, reserved: 0 });
    // Rien à libérer : aucune écriture release.
    expect(await entries(pipelineId)).toEqual(
      [
        `reserve ${total} reserve:pipe:P`,
        ...(["script", "titles", "seo", "voiceover", "thumbnails"] as const).map((t) => `capture ${costs[t]} capture:pipe:P:${t}`),
      ].sort(),
    );
  });

  it("un échec du script libère 100 % de la réservation", async () => {
    const { workspaceId, pipelineId } = await newPipeline();
    expect((await run(pipelineId, ["script"])).status).toBe("failed");

    expect(await account(workspaceId)).toEqual({ balance: 100, reserved: 0 });
    expect(await entries(pipelineId)).toEqual([`release ${total} release:pipe:P`, `reserve ${total} reserve:pipe:P`]);
  });

  it("un pipeline partial libère le coût de l'asset échoué et de ceux qui en dépendent", async () => {
    const { workspaceId, pipelineId } = await newPipeline();
    // titles refusé : thumbnails, qui en dépend, est sauté.
    expect((await run(pipelineId, ["titles"])).status).toBe("partial");

    const released = costs.titles + costs.thumbnails;
    expect(await account(workspaceId)).toEqual({ balance: 100 - (total - released), reserved: 0 });
    expect(await entries(pipelineId)).toContain(`release ${released} release:pipe:P`);
  });

  it("une exécution rejouée après un succès ne capture ni ne libère une seconde fois", async () => {
    const { workspaceId, pipelineId } = await newPipeline();
    await run(pipelineId, ["seo"]);
    const before = { account: await account(workspaceId), entries: await entries(pipelineId) };

    // Retry de toute la fonction : generateAsset renvoie les versions enregistrées, seo est retenté.
    expect((await run(pipelineId, ["seo"])).status).toBe("partial");
    expect(await account(workspaceId)).toEqual(before.account);
    expect(await entries(pipelineId)).toEqual(before.entries);
  });

  it("une génération qui se termine après l'annulation est enregistrée sans être facturée", async () => {
    const { workspaceId, pipelineId } = await newPipeline();
    const client = fakeAnthropic();
    await generateAsset(pipelineId, "script", { store, client });
    await store.setPipelineStatus(pipelineId, "canceled"); // l'utilisateur annule : reliquat libéré
    await generateAsset(pipelineId, "titles", { store, client }); // étape déjà partie

    expect(await account(workspaceId)).toEqual({ balance: 100 - costs.script, reserved: 0 });
    expect(await entries(pipelineId)).toEqual(
      [`reserve ${total} reserve:pipe:P`, `capture ${costs.script} capture:pipe:P:script`, `release ${total - costs.script} release:pipe:P`].sort(),
    );
    expect(await store.getCurrentVersion(pipelineId, "titles")).not.toBeNull();
  });
});

describe("balayage des réservations orphelines", () => {
  it("passe en échec un pipeline inactif depuis 30 min et libère sa réservation, sans toucher aux pipelines actifs", async () => {
    const idle = await newPipeline();
    const fresh = await newPipeline();
    const busy = await newPipeline(); // créé il y a longtemps, mais une génération vient de démarrer
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    unwrap(await admin.from("pipelines").update({ status: "running", created_at: old }).in("id", [idle.pipelineId, busy.pipelineId]).select());
    const generation = await store.upsertGeneration({ pipelineId: busy.pipelineId, assetType: "script", idempotencyKey: `pipe:${busy.pipelineId}:script`, credits: costs.script });
    await store.markRunning(generation.id, 1);

    expect(await sweepStaleReservations(admin)).toBeGreaterThanOrEqual(1);

    const pipelines = unwrap(await admin.from("pipelines").select("id, status").in("id", [idle.pipelineId, fresh.pipelineId, busy.pipelineId]));
    expect(Object.fromEntries(pipelines.map((p) => [p.id, p.status]))).toEqual({
      [idle.pipelineId]: "failed",
      [fresh.pipelineId]: "queued",
      [busy.pipelineId]: "running",
    });
    expect(await account(idle.workspaceId)).toEqual({ balance: 100, reserved: 0 });
    expect(await account(fresh.workspaceId)).toEqual({ balance: 100, reserved: total });
    const assets = unwrap(await admin.from("pipeline_assets").select("status").eq("pipeline_id", idle.pipelineId));
    expect(assets.map((a) => a.status)).toEqual(Array(5).fill("failed"));

    // Balayé deux fois : rien de plus.
    await sweepStaleReservations(admin);
    expect(await entries(idle.pipelineId)).toEqual([`release ${total} release:pipe:P`, `reserve ${total} reserve:pipe:P`]);
  });
});
