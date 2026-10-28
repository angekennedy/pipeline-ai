import { beforeEach, describe, expect, it } from "vitest";
import type { OpenAIClient } from "@/lib/ai/openai";
import type { Brief } from "@/lib/ai/schemas";
import type { ElevenLabsClient } from "@/lib/media/elevenlabs";
import type { ShotstackClient } from "@/lib/media/shotstack";
import { VideoManifestSchema } from "@/lib/video/manifest";
import { runVideoSteps, type VideoDeps, type VideoStepRunner } from "@/lib/video/run-video";
import { validBrief, validScript, validVoiceover } from "../../fixtures/assets";
import { FakeImages, FakeRender, FakeVoice, MemoryMediaStorage } from "../../mocks/media";
import { MemoryPipelineStore } from "../../mocks/memory-store";

const PIPELINE_ID = "6f0c2b1e-8d4a-4c3b-9e2f-1a2b3c4d5e6f";
const WORKSPACE_ID = "0b6c1e2d-3f4a-4b5c-8d9e-0f1a2b3c4d5e";
const REQUEST = { key: "regen:1a2b3c4d-video", credits: 60 };

let store: MemoryPipelineStore;
let storage: MemoryMediaStorage;
let voice: FakeVoice;
let images: FakeImages;
let steps: string[];
let sleeps: Array<[string, number]>;

const runner = (): VideoStepRunner => ({
  run: async (id, fn) => {
    steps.push(id);
    return fn();
  },
  sleep: async (id, ms) => {
    sleeps.push([id, ms]);
  },
});

const deps = (render: FakeRender): VideoDeps => ({
  store,
  storage,
  openai: images as unknown as OpenAIClient,
  voice: voice as unknown as ElevenLabsClient,
  render: render as unknown as ShotstackClient,
  config: { voiceId: "voice1", voiceModel: "eleven_multilingual_v2", imageModel: "gpt-image-2", sandbox: true },
});

beforeEach(() => {
  store = new MemoryPipelineStore();
  storage = new MemoryMediaStorage();
  voice = new FakeVoice();
  images = new FakeImages();
  steps = [];
  sleeps = [];
  store.addPipeline({ id: PIPELINE_ID, workspaceId: WORKSPACE_ID, brief: { ...validBrief, durationMinutes: 1, video: true } as Brief, channel: null, tier: "standard" });
  const scriptId = store.seedVersion(PIPELINE_ID, "script", validScript);
  store.seedVersion(
    PIPELINE_ID,
    "voiceover",
    { ...validVoiceover, segments: [1, 2, 3, 4].map((sceneIndex) => ({ ...validVoiceover.segments[0]!, sceneIndex, text: `Scène ${sceneIndex} [pause:600ms] du récit.` })) },
    { sourceVersions: { script: scriptId } },
  );
});

describe("runVideoSteps", () => {
  it("produit voix, images, sous-titres et rendu, puis enregistre la vidéo et son coût", async () => {
    const render = new FakeRender({ pollsBeforeDone: 2 });
    const versionId = await runVideoSteps(PIPELINE_ID, REQUEST, runner(), deps(render));

    // Une voix par scène, lue sans les indications de pause, avec le texte voisin pour l'intonation.
    expect(voice.requests.map((r) => r.text)).toEqual([1, 2, 3, 4].map((n) => `Scène ${n}… du récit.`));
    expect(voice.requests[1]).toMatchObject({ voiceId: "voice1", modelId: "eleven_multilingual_v2", previousText: "Scène 1… du récit.", nextText: "Scène 3… du récit." });
    expect(steps).toEqual(expect.arrayContaining(["video:start", "video:voice:1", "video:voice:4", "video:image:1", "video:captions", "video:submit", "video:poll:3", "video:commit"]));
    expect(sleeps).toEqual([["video:wait:1", 30_000], ["video:wait:2", 30_000], ["video:wait:3", 30_000]]);

    const version = store.versions.find((v) => v.id === versionId)!;
    expect(version).toMatchObject({ assetType: "video", schemaVersion: "video@1", source: "ai" });
    const manifest = VideoManifestSchema.parse(version.content);
    expect(manifest).toMatchObject({ url: "https://cdn.shotstack.test/render-1.mp4", renderId: "render-1", durationSeconds: 42, sandbox: true });
    expect(manifest.voice.map((v) => v.sceneIndex)).toEqual([1, 2, 3, 4]);
    expect(manifest.shots).toHaveLength(images.prompts.length);

    // Médias rangés sous le workspace et le pipeline ; sous-titres SRT calés sur la voix.
    const prefix = `${WORKSPACE_ID}/${PIPELINE_ID}/video/`;
    expect([...storage.files.keys()].every((path) => path.startsWith(prefix))).toBe(true);
    // La pause (points de suspension) clôt un sous-titre, comme une fin de phrase.
    expect(storage.text(manifest.captionsPath)).toMatch(/^1\r\n00:00:00,000 --> 00:00:00,400\r\nScène 1…\r\n\r\n2\r\n00:00:00,450 --> 00:00:00,900\r\ndu récit\./);

    // Montage : sources signées, une voix par scène, sous-titres sur toute la durée.
    const edit = render.edits[0]!;
    expect(edit.timeline.tracks[1]!.clips).toHaveLength(4);
    expect(JSON.stringify(edit)).toContain("https://storage.test/");

    // Coût : images (usage × tarif) + voix (caractères) + rendu (secondes), crédits de la vidéo capturés.
    const generation = store.generation(REQUEST.key);
    expect(generation).toMatchObject({ status: "succeeded", credits: 60, versionId });
    const characters = voice.requests.reduce((sum, r) => sum + r.text.length, 0);
    expect(generation.telemetry!.costUsdMicros).toBe(images.prompts.length * (100 * 5 + 6000 * 30) + characters * 80 + Math.round(42 * Math.round(200_000 / 60)));
    // Le bail est repoussé à chaque étape longue.
    expect(store.touches.length).toBeGreaterThanOrEqual(voice.requests.length + images.prompts.length + 3);
  });

  it("enregistre l'échec du rendu sur la génération, sans version", async () => {
    await expect(runVideoSteps(PIPELINE_ID, REQUEST, runner(), deps(new FakeRender({ fail: "asset introuvable" })))).rejects.toThrow(/asset introuvable/);
    expect(store.generation(REQUEST.key)).toMatchObject({ status: "failed", failure: { code: "INTERNAL", message: expect.stringContaining("asset introuvable") } });
    expect(store.versions.filter((v) => v.assetType === "video")).toHaveLength(0);
    expect(steps.at(-1)).toBe("video:fail");
  });

  it("relance l'étape finale tant que le MP4 n'est pas hébergé", async () => {
    await expect(runVideoSteps(PIPELINE_ID, REQUEST, runner(), deps(new FakeRender({ hostedUrl: null })))).rejects.toThrow(/pas encore hébergé/);
  });

  it("ne refait rien quand la vidéo est déjà terminée", async () => {
    const first = await runVideoSteps(PIPELINE_ID, REQUEST, runner(), deps(new FakeRender()));
    const calls = voice.requests.length;
    expect(await runVideoSteps(PIPELINE_ID, REQUEST, runner(), deps(new FakeRender()))).toBe(first);
    expect(voice.requests).toHaveLength(calls);
  });

  it("lit la narration du script quand la voix off date d'une version précédente du script", async () => {
    const edited = { ...validScript, scenes: validScript.scenes.map((scene) => ({ ...scene, narration: `Narration réécrite de la scène ${scene.index}, lue telle quelle.` })) };
    const editedId = store.seedVersion(PIPELINE_ID, "script", edited, { source: "user_edit" });
    const versionId = await runVideoSteps(PIPELINE_ID, REQUEST, runner(), deps(new FakeRender()));
    expect(voice.requests.map((r) => r.text)).toEqual(edited.scenes.map((scene) => scene.narration));
    expect(store.versions.find((v) => v.id === versionId)!.sourceVersions).toEqual({ script: editedId });
  });
});
