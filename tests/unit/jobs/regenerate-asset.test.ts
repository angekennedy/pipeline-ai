import Anthropic from "@anthropic-ai/sdk";
import { InngestTestEngine } from "@inngest/test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Brief } from "@/lib/ai/schemas";
import { createRegenerateAssetFunction } from "@/lib/jobs/functions/regenerate-asset";
import type { PipelineEvent } from "@/lib/realtime/events";
import { anthropicSequence, jsonReplyStream, refusalStream } from "../../mocks/anthropic";
import { MemoryPipelineStore } from "../../mocks/memory-store";
import { server } from "../../mocks/server";
import { validBrief, validScript, validSeo, validThumbnails, validTitles, validVoiceover } from "../../fixtures/assets";

const PIPELINE_ID = "7d0e6f4a-3c1b-4e8a-9f2d-5b6c7a8e9f01";
const WORKSPACE_ID = "1f2e3d4c-5b6a-4987-8a1b-2c3d4e5f6a7b";
const client = new Anthropic({ apiKey: "test-key", maxRetries: 0 });

let store: MemoryPipelineStore;
let events: PipelineEvent[];

beforeEach(() => {
  store = new MemoryPipelineStore();
  events = [];
  store.addPipeline({ id: PIPELINE_ID, workspaceId: WORKSPACE_ID, brief: validBrief as Brief, channel: null, tier: "standard" });
  const script = store.seedVersion(PIPELINE_ID, "script", validScript);
  const titles = store.seedVersion(PIPELINE_ID, "titles", validTitles, { sourceVersions: { script } });
  store.seedVersion(PIPELINE_ID, "seo", validSeo, { sourceVersions: { script } });
  store.seedVersion(PIPELINE_ID, "voiceover", validVoiceover, { sourceVersions: { script } });
  store.seedVersion(PIPELINE_ID, "thumbnails", validThumbnails, { sourceVersions: { script, titles } });
});

const createFn = () =>
  createRegenerateAssetFunction({ store: () => store, anthropic: client, publisher: () => async (event) => void events.push(event) });

const run = (data: Record<string, unknown>) =>
  new InngestTestEngine({
    function: createFn(),
    events: [{ name: "asset/regenerate.requested", data: { pipelineId: PIPELINE_ID, workspaceId: WORKSPACE_ID, ...data } }],
  }).execute();

function mock(...replies: Array<() => Response>) {
  const sequence = anthropicSequence(...replies);
  server.use(sequence.handler);
  return sequence.calls;
}

describe("fonction Inngest regenerate-asset", () => {
  it("régénère l'asset demandé et renvoie les assets devenus obsolètes", async () => {
    mock(() => jsonReplyStream(validTitles, { model: "claude-haiku-5-5" }));
    const { result } = await run({ assetType: "titles", regenerationKey: "regen:abcdef12", feedback: "Plus courts" });

    expect(result).toEqual({ versionIds: [expect.any(String)], stale: ["thumbnails"] });
    expect(await store.listVersions(PIPELINE_ID, "titles")).toMatchObject([{ source: "ai_regen" }, { source: "ai" }]);
    expect(store.generation("regen:abcdef12").userFeedback).toBe("Plus courts");
    expect(events.map((event) => event.type)).toEqual(["asset.started", "asset.completed"]);
  });

  it("transforme un refus en erreur non relançable", async () => {
    mock(() => refusalStream("cyber"));
    const { error } = await run({ assetType: "script", regenerationKey: "regen:abcdef13" });
    expect(error).toMatchObject({ name: "NonRetriableError" });
    expect(store.generation("regen:abcdef13").failure).toMatchObject({ code: "CONTENT_REFUSED" });
  });

  it.each([
    ["sans clé de régénération", { assetType: "titles" }],
    ["clé mal formée", { assetType: "titles", regenerationKey: "pipe:123" }],
    ["asset inconnu", { assetType: "video", regenerationKey: "regen:abcdef14" }],
    ["consigne trop longue", { assetType: "titles", regenerationKey: "regen:abcdef15", feedback: "x".repeat(1001) }],
  ])("rejette un événement invalide : %s", async (_, data) => {
    const calls = mock(() => jsonReplyStream(validTitles));
    const { error } = await run(data);
    expect(error).toBeDefined();
    expect(calls).toHaveLength(0);
  });

  it("déclare l'idempotence par demande et la concurrence par workspace", () => {
    expect(createFn().opts).toMatchObject({
      id: "regenerate-asset",
      idempotency: "event.data.regenerationKey",
      concurrency: [{ key: "event.data.workspaceId", limit: 2 }],
      retries: 3,
    });
  });
});

describe("régénération des dérivés", () => {
  it("régénère les titres puis les miniatures, qui partent des nouveaux titres", async () => {
    const calls = mock(
      () => jsonReplyStream({ ...validTitles, variants: validTitles.variants.map((v) => ({ ...v, title: `${v.title} (v2)` })) }, { model: "claude-haiku-5-5" }),
      () => jsonReplyStream(validThumbnails, { model: "claude-haiku-5-5" }),
    );
    const { result } = await run({
      assetType: "titles",
      regenerationKey: "regen:abcdef20-titles",
      then: [{ assetType: "thumbnails", regenerationKey: "regen:abcdef20-thumbnails" }],
    });
    expect(result).toEqual({ versionIds: [expect.any(String), expect.any(String)], stale: [] });
    expect(JSON.stringify(calls[1])).toContain("(v2)"); // le prompt des miniatures cite les titres régénérés
    expect(store.generation("regen:abcdef20-thumbnails")).toBeDefined();
  });
});

describe("échec définitif d'une régénération", () => {
  it("libère sa réservation, une fois les relances épuisées", async () => {
    const { releaseFailedRegeneration } = await import("@/lib/jobs/functions/regenerate-asset");
    const released: string[] = [];
    const event = { data: { event: { data: { regenerationKey: "regen:abcdef14-titles", then: [{ regenerationKey: "regen:abcdef14-thumbnails" }] } } } };
    await releaseFailedRegeneration(async (key) => (released.push(key), 3))({ event });
    expect(released).toEqual(["regen:abcdef14-titles", "regen:abcdef14-thumbnails"]);
  });
});
