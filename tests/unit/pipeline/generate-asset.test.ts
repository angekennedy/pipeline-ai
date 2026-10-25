import Anthropic from "@anthropic-ai/sdk";
import { HttpResponse } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LlmRefusalError } from "@/lib/ai/structured";
import type { PipelineEvent } from "@/lib/realtime/events";
import type { Brief, ChannelPreset } from "@/lib/ai/schemas";
import { MissingDependencyError, generateAsset } from "@/lib/pipeline/generate-asset";
import type { ModelTier } from "@/lib/pipeline/registry";
import { anthropicSequence, jsonReplyStream, refusalStream } from "../../mocks/anthropic";
import { MemoryPipelineStore } from "../../mocks/memory-store";
import { server } from "../../mocks/server";
import { validBrief, validChannel, validScript, validSeo, validTitles, validVoiceover } from "../../fixtures/assets";

const client = new Anthropic({ apiKey: "test-key", maxRetries: 0 });
const PIPELINE_ID = "7d0e6f4a-3c1b-4e8a-9f2d-5b6c7a8e9f01";

let store: MemoryPipelineStore;

function addPipeline(tier: ModelTier = "standard") {
  store.addPipeline({
    id: PIPELINE_ID,
    workspaceId: "ws-1",
    brief: validBrief as Brief,
    channel: validChannel as ChannelPreset,
    tier,
  });
}

function mock(...replies: Array<() => Response>) {
  const sequence = anthropicSequence(...replies);
  server.use(sequence.handler);
  return sequence.calls;
}

const overloaded = () =>
  HttpResponse.json({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, { status: 529 });

const run = (type: Parameters<typeof generateAsset>[1], options = {}) =>
  generateAsset(PIPELINE_ID, type, { store, client, ...options });

beforeEach(() => {
  store = new MemoryPipelineStore();
  addPipeline();
});

describe("generateAsset", () => {
  it("génère le script, le post-traite et enregistre la version avec sa télémétrie", async () => {
    const calls = mock(() => jsonReplyStream(validScript, { usage: { input_tokens: 1000, output_tokens: 500 } }));
    const versionId = await run("script");

    const version = store.versions.find((v) => v.id === versionId)!;
    expect(version).toMatchObject({ assetType: "script", version: 1, schemaVersion: "script@1", source: "ai", sourceVersions: {} });
    // Durées recalculées depuis la narration : 20 mots à 150 mots/min, soit 8 s par scène.
    expect((version.content as typeof validScript).scenes.map((s) => s.estimatedSeconds)).toEqual([8, 8, 8, 8]);

    const generation = store.generation(`pipe:${PIPELINE_ID}:script`);
    expect(generation).toMatchObject({ status: "succeeded", attempt: 1, versionId, credits: 12 });
    expect(generation.telemetry).toMatchObject({
      model: "claude-sonnet-5-5",
      promptVersion: "script@1",
      usage: { inputTokens: 1000, outputTokens: 500 },
      costUsdMicros: 1000 * 2 + 500 * 10,
      repairs: 0,
      attempts: 1,
    });
    expect(generation.telemetry!.latencyMs).toBeGreaterThanOrEqual(0);

    const body = calls[0]!.body as { model: string; max_tokens: number; system: Array<{ text: string }> };
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBe(8000 + 1200 * 4);
    expect(body.system[0]!.text).toContain("scriptwriter");
  });

  it("utilise Opus pour un pipeline Premium", async () => {
    const calls = mock(() => jsonReplyStream(validScript, { model: "claude-opus-5-5" }));
    store = new MemoryPipelineStore();
    addPipeline("premium");
    await run("script");
    expect(calls[0]!.body.model).toBe("claude-opus-5-5");
    expect(store.generation(`pipe:${PIPELINE_ID}:script`).credits).toBe(24);
  });

  it("ne rappelle pas le modèle quand l'étape est rejouée après un succès", async () => {
    const calls = mock(() => jsonReplyStream(validScript));
    const first = await run("script");
    const second = await run("script");

    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
    expect(store.versions).toHaveLength(1);
    expect(store.generation(`pipe:${PIPELINE_ID}:script`).attempt).toBe(1);
  });

  it("enregistre l'échec d'une erreur transitoire, puis réussit à la tentative suivante", async () => {
    const calls = mock(overloaded, () => jsonReplyStream(validScript));

    const error = await run("script").catch((e) => e);
    expect(error).toBeInstanceOf(Anthropic.APIError);
    expect(store.generation(`pipe:${PIPELINE_ID}:script`)).toMatchObject({
      status: "failed",
      attempt: 1,
      failure: { code: "PROVIDER_ERROR", costUsdMicros: null },
    });

    await run("script");
    expect(store.generation(`pipe:${PIPELINE_ID}:script`)).toMatchObject({ status: "succeeded", attempt: 2, failure: undefined });
    expect(calls).toHaveLength(2);
  });

  it("enregistre un refus avec son code et son coût, puis le laisse remonter", async () => {
    mock(() => refusalStream("cyber"));
    await expect(run("script")).rejects.toBeInstanceOf(LlmRefusalError);
    expect(store.generation(`pipe:${PIPELINE_ID}:script`).failure).toMatchObject({
      code: "CONTENT_REFUSED",
      costUsdMicros: expect.any(Number),
    });
  });

  it("génère un dérivé à partir de la version courante du script", async () => {
    const scriptVersionId = store.seedVersion(PIPELINE_ID, "script", validScript);
    const calls = mock(() => jsonReplyStream(validSeo, { model: "claude-haiku-5-5" }));
    const versionId = await run("seo");

    const version = store.versions.find((v) => v.id === versionId)!;
    expect(version.sourceVersions).toEqual({ script: scriptVersionId });
    expect((version.content as { chapters: unknown[] }).chapters).toHaveLength(3);

    const body = calls[0]!.body as { model: string; messages: Array<{ content: Array<{ text: string }> }> };
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.messages[0]!.content[0]!.text).toContain("<final_script>");
  });

  it("demande une réparation quand la sortie ne colle pas au script (une scène sans voix off)", async () => {
    store.seedVersion(PIPELINE_ID, "script", validScript);
    const complete = { ...validVoiceover, segments: [1, 2, 3, 4].map((sceneIndex) => ({ ...validVoiceover.segments[0]!, sceneIndex })) };
    const calls = mock(
      () => jsonReplyStream(validVoiceover, { model: "claude-haiku-5-5" }),
      () => jsonReplyStream(complete, { model: "claude-haiku-5-5" }),
    );
    await run("voiceover");

    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1]!.body.messages)).toContain("Scènes sans segment : 2, 3, 4");
    expect(store.generation(`pipe:${PIPELINE_ID}:voiceover`).telemetry).toMatchObject({ repairs: 1, attempts: 2 });
  });

  it("refuse de générer un dérivé dont une dépendance manque, sans appeler le modèle", async () => {
    store.seedVersion(PIPELINE_ID, "script", validScript);
    const calls = mock(() => jsonReplyStream(validTitles));

    const error = await run("thumbnails").catch((e) => e);
    expect(error).toBeInstanceOf(MissingDependencyError);
    expect(error).toMatchObject({ code: "DEPENDENCY_MISSING", retryable: false, missing: ["titles"] });
    expect(calls).toHaveLength(0);
    expect(store.generation(`pipe:${PIPELINE_ID}:thumbnails`).failure).toMatchObject({ code: "DEPENDENCY_MISSING" });
  });

  it("transmet le texte au fil du stream", async () => {
    mock(() => jsonReplyStream(validScript, { chunkSize: 50 }));
    const onText = vi.fn();
    await run("script", { onText });
    expect(onText.mock.calls.length).toBeGreaterThan(5);
  });
});

describe("generateAsset : événements Realtime", () => {
  const recorder = () => {
    const events: PipelineEvent[] = [];
    return { events, publish: async (event: PipelineEvent) => void events.push(event) };
  };
  const types = (events: PipelineEvent[]) => events.map((event) => event.type);

  it("script : started, scènes au fil du stream, puis completed avec l'id de version", async () => {
    mock(() => jsonReplyStream(validScript, { chunkSize: 40 }));
    const { events, publish } = recorder();
    const versionId = await run("script", { publish });

    expect(types(events)[0]).toBe("asset.started");
    expect(events.at(-1)).toEqual({ type: "asset.completed", asset: "script", versionId });
    const sent = events.flatMap((event) => (event.type === "asset.partial" ? event.scenes.map((s) => s.index) : []));
    expect(sent).toEqual([1, 2, 3, 4]); // chaque scène une fois, avant completed
  });

  it("dérivé : started puis completed, sans scènes partielles", async () => {
    store.seedVersion(PIPELINE_ID, "script", validScript);
    mock(() => jsonReplyStream(validTitles, { model: "claude-haiku-5-5" }));
    const { events, publish } = recorder();
    await run("titles", { publish });
    expect(types(events)).toEqual(["asset.started", "asset.completed"]);
  });

  it("échec : asset.failed avec le code, sans scène après l'échec", async () => {
    mock(() => refusalStream("cyber"));
    const { events, publish } = recorder();
    await expect(run("script", { publish })).rejects.toBeInstanceOf(LlmRefusalError);
    expect(events).toEqual([
      { type: "asset.started", asset: "script" },
      { type: "asset.failed", asset: "script", code: "CONTENT_REFUSED" },
    ]);
  });

  it("étape rejouée après un succès : aucun événement", async () => {
    mock(() => jsonReplyStream(validScript));
    await run("script");
    const { events, publish } = recorder();
    await run("script", { publish });
    expect(events).toEqual([]);
  });

  it("un envoi en échec ne fait pas échouer la génération", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mock(() => jsonReplyStream(validScript));
    await expect(run("script", { publish: async () => Promise.reject(new Error("réseau")) })).resolves.toEqual(expect.any(String));
    vi.restoreAllMocks();
  });
});
