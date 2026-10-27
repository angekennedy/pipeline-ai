import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Brief } from "@/lib/ai/schemas";
import { pipelineCredits } from "@/lib/billing/costs";
import { PlanRestrictionError } from "@/lib/billing/entitlements";
import { PLAN_KEYS, PLANS, type PlanKey } from "@/lib/billing/plans";
import { createPipelineWithReservation } from "@/lib/billing/reservation";
import { MEDIA_BUCKET, mediaPath, supabaseMediaStorage } from "@/lib/media/storage";
import { SupabasePipelineStore } from "@/lib/supabase/pipeline-store";
import { validBrief } from "../fixtures/assets";
import { admin, cleanup, createUser, createWorkspace, unwrap, withPg, type TestUser } from "./helpers";

// Vidéo MP4 en base (migration 0017) : option réservée aux plans payants, asset créé à la demande,
// bail prolongé pendant un rendu long, médias lisibles par les seuls membres du workspace.

let owner: TestUser;
let stranger: TestUser;

beforeAll(async () => {
  owner = await createUser("video");
  stranger = await createUser("video-stranger");
});
afterAll(cleanup);

async function workspaceOn(plan: PlanKey, balance = 5000) {
  const workspaceId = await createWorkspace(owner, `video-${plan}`);
  unwrap(await admin.from("workspaces").update({ plan_key: plan }).eq("id", workspaceId).select());
  await withPg((pg) => pg.query("select private.credit_op($1, 'grant', $2, $3)", [workspaceId, balance, `grant:${workspaceId}`]));
  return workspaceId;
}

const brief = (video?: boolean) => ({ ...validBrief, durationMinutes: 2, ...(video !== undefined && { video }) }) as Brief;
const create = (workspaceId: string, video?: boolean) =>
  createPipelineWithReservation(admin, { workspaceId, userId: owner.id, brief: brief(video), tier: "standard", idempotencyKey: randomUUID() });
const assetTypes = async (pipelineId: string) =>
  unwrap(await admin.from("pipeline_assets").select("type").eq("pipeline_id", pipelineId)).map((row) => row.type).sort();

describe("private.plan_allows_video", () => {
  it("reprend PLANS.video, et refuse un plan inconnu", async () => {
    const rows = await withPg(async (pg) => {
      const out: Record<string, boolean> = {};
      for (const key of [...PLAN_KEYS, "legacy"]) out[key] = (await pg.query("select private.plan_allows_video($1) as ok", [key])).rows[0].ok;
      return out;
    });
    for (const key of PLAN_KEYS) expect(rows[key], key).toBe(PLANS[key].video);
    expect(rows.legacy).toBe(false);
  });
});

describe("création d'un pipeline avec vidéo", () => {
  it("refuse la vidéo sur Free (403), sans rien créer ni réserver", async () => {
    const workspaceId = await workspaceOn("free", 1000);
    const error = await create(workspaceId, true).catch((e) => e);
    expect(error).toBeInstanceOf(PlanRestrictionError);
    expect(error).toMatchObject({ restriction: { reason: "video", plan: "free" } });
    const account = unwrap(await admin.from("credit_accounts").select("reserved").eq("workspace_id", workspaceId).single());
    expect(account.reserved).toBe(0);
  });

  it("réserve la vidéo et crée son asset sur un plan payant ; sans option, pas d'asset vidéo", async () => {
    const workspaceId = await workspaceOn("creator");
    const withVideo = await create(workspaceId, true);
    expect(withVideo.credits).toBe(pipelineCredits(brief(true), "standard"));
    expect(await assetTypes(withVideo.pipelineId)).toEqual(["script", "seo", "thumbnails", "titles", "video", "voiceover"]);

    const without = await create(workspaceId, false);
    expect(await assetTypes(without.pipelineId)).toEqual(["script", "seo", "thumbnails", "titles", "voiceover"]);
  });
});

describe("touch_generation", () => {
  it("repousse le bail d'une génération en cours, et rien d'autre", async () => {
    const workspaceId = await workspaceOn("creator");
    const { pipelineId } = await create(workspaceId, true);
    const store = new SupabasePipelineStore(admin);
    const generation = await store.upsertGeneration({ pipelineId, assetType: "video", idempotencyKey: `pipe:${pipelineId}:video`, credits: 120 });
    expect(await store.touchGeneration(generation.id)).toBe(false); // pas encore prise

    await store.markRunning(generation.id, 1);
    await withPg((pg) => pg.query("update public.generations set started_at = now() - interval '20 minutes' where id = $1", [generation.id]));
    expect(await store.touchGeneration(generation.id)).toBe(true);
    const row = unwrap(await admin.from("generations").select("started_at").eq("id", generation.id).single());
    expect(Date.now() - Date.parse(row.started_at!)).toBeLessThan(60_000);
  });
});

describe("médias des pipelines", () => {
  it("se lisent par lien signé pour les membres du workspace, jamais pour les autres", async () => {
    const workspaceId = await workspaceOn("creator");
    const { pipelineId } = await create(workspaceId, true);
    const path = mediaPath(workspaceId, pipelineId, "thumbnails", "gen-1.jpg");
    await supabaseMediaStorage(admin).upload(path, new TextEncoder().encode("jpeg"), "image/jpeg");

    const member = await owner.client.storage.from(MEDIA_BUCKET).createSignedUrl(path, 60);
    expect(member.error).toBeNull();
    expect(member.data?.signedUrl).toContain(encodeURI(path).split("/").pop());

    const other = await stranger.client.storage.from(MEDIA_BUCKET).createSignedUrl(path, 60);
    expect(other.data).toBeNull();
    expect(other.error).not.toBeNull();
  });

  it("refuse l'écriture aux utilisateurs : seul le worker (service role) dépose les médias", async () => {
    const workspaceId = await workspaceOn("creator");
    const { pipelineId } = await create(workspaceId, true);
    const { error } = await owner.client.storage.from(MEDIA_BUCKET).upload(mediaPath(workspaceId, pipelineId, "x.jpg"), new Uint8Array([1]), { contentType: "image/jpeg" });
    expect(error).not.toBeNull();
  });
});
