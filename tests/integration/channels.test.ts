import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelPresetSchema, type Brief } from "@/lib/ai/schemas";
import { PlanRestrictionError } from "@/lib/billing/entitlements";
import { createPipelineWithReservation } from "@/lib/billing/reservation";
import { createChannel, deleteChannel, getChannel, listChannels, updateChannel } from "@/lib/channels/store";
import { SupabasePipelineStore } from "@/lib/supabase/pipeline-store";
import { validBrief, validChannel } from "../fixtures/assets";
import { admin, cleanup, createUser, unwrap, type TestUser } from "./helpers";

// Presets de chaîne (tâche 2.5) : écrits avec le client de l'utilisateur, sous RLS et sous la limite
// du plan, puis figés dans chaque pipeline (`channel_snapshot`).

const preset = ChannelPresetSchema.parse(validChannel);
let a: TestUser;
let b: TestUser;
let wsA: string;
let channelId: string;

async function personal(user: TestUser) {
  return unwrap(await admin.from("workspace_members").select("workspace_id").eq("user_id", user.id).single()).workspace_id;
}

beforeAll(async () => {
  [a, b] = await Promise.all([createUser("ch-a"), createUser("ch-b")]);
  wsA = await personal(a);
});
afterAll(cleanup);

describe("presets de chaîne", () => {
  it("crée, liste et relit un preset du workspace", async () => {
    channelId = await createChannel(a.client, wsA, preset);
    expect(await listChannels(a.client, wsA)).toEqual([{ id: channelId, preset, updatedAt: expect.any(String) }]);
    expect(await getChannel(a.client, wsA, channelId)).toEqual({ id: channelId, preset, updatedAt: expect.any(String) });
  });

  it("refuse un preset de plus que le plan Free n'en permet, avec la limite", async () => {
    const error = await createChannel(a.client, wsA, { ...preset, name: "Second" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlanRestrictionError);
    expect((error as PlanRestrictionError).restriction).toEqual({ reason: "channel_presets", plan: "free", limit: 1 });
    expect(await listChannels(a.client, wsA)).toHaveLength(1);
  });

  it("ne laisse B ni lire, ni modifier, ni supprimer, ni créer dans le workspace de A", async () => {
    expect(await listChannels(b.client, wsA)).toEqual([]);
    expect(await getChannel(b.client, wsA, channelId)).toBeNull();
    expect(await updateChannel(b.client, wsA, channelId, { ...preset, name: "Piraté" })).toBe(false);
    expect(await deleteChannel(b.client, wsA, channelId)).toBe(false);
    await expect(createChannel(b.client, wsA, preset)).rejects.toThrow(/row-level security/);
    expect((await getChannel(a.client, wsA, channelId))?.preset.name).toBe(preset.name);
  });
});

describe("copie figée dans le pipeline", () => {
  it("garde le preset du lancement, même modifié puis supprimé", async () => {
    const { pipelineId } = await createPipelineWithReservation(admin, {
      workspaceId: wsA,
      userId: a.id,
      brief: { ...(validBrief as Brief), channelId },
      tier: "standard",
      idempotencyKey: randomUUID(),
      channel: { id: channelId, snapshot: preset },
    });
    const store = new SupabasePipelineStore(admin);
    expect((await store.getPipeline(pipelineId)).channel).toEqual(preset);

    expect(await updateChannel(a.client, wsA, channelId, { ...preset, name: "Mystères (v2)", tone: "humorous" })).toBe(true);
    expect((await getChannel(a.client, wsA, channelId))?.preset).toMatchObject({ name: "Mystères (v2)", tone: "humorous" });
    expect((await store.getPipeline(pipelineId)).channel).toEqual(preset);

    expect(await deleteChannel(a.client, wsA, channelId)).toBe(true);
    const row = unwrap(await admin.from("pipelines").select("channel_id, channel_snapshot").eq("id", pipelineId).single());
    expect(row).toEqual({ channel_id: null, channel_snapshot: preset });
    expect(await listChannels(a.client, wsA)).toEqual([]);
  });
});
