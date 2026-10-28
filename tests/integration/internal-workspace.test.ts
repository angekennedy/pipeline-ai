import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Brief } from "@/lib/ai/schemas";
import { setInternalWorkspace } from "@/lib/admin/internal-workspaces";
import { getCreditSummary } from "@/lib/billing/balance";
import { pipelineCredits } from "@/lib/billing/costs";
import { InsufficientCreditsError, createPipelineWithReservation, reserveRegeneration } from "@/lib/billing/reservation";
import { validBrief } from "../fixtures/assets";
import { admin, cleanup, createUser, createWorkspace, unwrap, type TestUser } from "./helpers";

// Workspaces internes (migration 0018) : tous les droits et des crédits complétés à la demande, posés
// par le service role seulement.

let owner: TestUser;

beforeAll(async () => {
  owner = await createUser("internal");
});
afterAll(cleanup);

const videoBrief = { ...validBrief, durationMinutes: 30, video: true, thumbnailImages: true } as Brief;
const create = (workspaceId: string, brief: Brief = videoBrief, tier: "standard" | "premium" = "premium") =>
  createPipelineWithReservation(admin, { workspaceId, userId: owner.id, brief, tier, idempotencyKey: randomUUID() });
const ledger = async (workspaceId: string) =>
  unwrap(await admin.from("credit_ledger").select("kind, amount, idempotency_key, metadata").eq("workspace_id", workspaceId).order("created_at"));
const slugOf = async (workspaceId: string) => unwrap(await admin.from("workspaces").select("slug").eq("id", workspaceId).single()).slug;

describe("workspace interne", () => {
  it("lance sur Free un pipeline Premium de 30 min avec vidéo, en complétant les crédits manquants", async () => {
    const workspaceId = await createWorkspace(owner, "internal-free");
    expect(await setInternalWorkspace(admin, await slugOf(workspaceId), true)).toBe(true);

    const credits = pipelineCredits(videoBrief, "premium");
    const { pipelineId, created } = await create(workspaceId);
    expect(created).toBe(true);

    const entries = await ledger(workspaceId);
    const grant = entries.find((entry) => entry.idempotency_key === `grant:internal:pipe:${pipelineId}`)!;
    expect(grant).toMatchObject({ kind: "grant", metadata: { reason: "internal" } });
    expect(entries.at(-1)).toMatchObject({ kind: "reserve", amount: credits });
    const summary = await getCreditSummary(admin, workspaceId);
    expect(summary).toMatchObject({ unlimited: true, available: 0 });
  });

  it("ne complète rien quand le solde suffit, et réserve aussi les régénérations", async () => {
    const workspaceId = await createWorkspace(owner, "internal-regen");
    await setInternalWorkspace(admin, await slugOf(workspaceId), true);
    const { pipelineId } = await create(workspaceId);
    const before = (await ledger(workspaceId)).length;

    const key = `regen:${randomUUID()}`;
    expect(await reserveRegeneration(admin, { workspaceId, userId: owner.id, pipelineId, key, credits: 50, tier: "premium" })).toBe(true);
    const added = (await ledger(workspaceId)).slice(before);
    expect(added.map((entry) => [entry.kind, entry.amount, entry.idempotency_key])).toEqual([
      ["grant", 50, `grant:internal:${key}`],
      ["reserve", 50, `reserve:${key}`],
    ]);
  });

  it("garde les règles du plan pour un workspace ordinaire, et le statut se retire", async () => {
    const workspaceId = await createWorkspace(owner, "internal-off");
    const slug = await slugOf(workspaceId);
    await expect(create(workspaceId)).rejects.toMatchObject({ restriction: { reason: "duration", plan: "free" } });

    await setInternalWorkspace(admin, slug, true);
    await setInternalWorkspace(admin, slug, false);
    const error = await create(workspaceId, { ...validBrief, durationMinutes: 2 } as Brief, "standard").catch((e) => e);
    // De nouveau ordinaire : rien n'est complété, le solde de départ (vide ici) ne suffit pas.
    expect(error).toBeInstanceOf(InsufficientCreditsError);
    expect(await setInternalWorkspace(admin, "slug-inexistant", true)).toBe(false);
  });

  it("lève la limite de presets de chaîne (1 sur Free)", async () => {
    const workspaceId = await createWorkspace(owner, "internal-presets");
    await setInternalWorkspace(admin, await slugOf(workspaceId), true);
    for (let i = 0; i < 3; i++) {
      const { error } = await owner.client.from("channels").insert({ workspace_id: workspaceId, name: `Chaîne ${i}`, niche: "histoire" });
      expect(error).toBeNull();
    }
  });

  it("ne peut pas être posé par un utilisateur, même propriétaire", async () => {
    const workspaceId = await createWorkspace(owner, "internal-self");
    await owner.client.from("workspaces").update({ is_internal: true } as never).eq("id", workspaceId);
    const row = unwrap(await admin.from("workspaces").select("is_internal").eq("id", workspaceId).single());
    expect(row.is_internal).toBe(false);
    const { error } = await owner.client.rpc("set_workspace_internal", { p_workspace: workspaceId, p_internal: true });
    expect(error).not.toBeNull();
  });
});
