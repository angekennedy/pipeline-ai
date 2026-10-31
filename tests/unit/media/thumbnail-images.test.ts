import { describe, expect, it } from "vitest";
import type { OpenAIClient } from "@/lib/ai/openai";
import { OpenAIClient as Client } from "@/lib/ai/openai";
import type { Brief, ThumbnailConcept, Thumbnails } from "@/lib/ai/schemas";
import { mediaPath } from "@/lib/media/storage";
import { renderThumbnailImages, thumbnailPrompt } from "@/lib/media/thumbnail-images";
import { generateAsset } from "@/lib/pipeline/generate-asset";
import { validBrief, validScript, validThumbnails, validTitles } from "../../fixtures/assets";
import { FakeImages, MemoryMediaStorage } from "../../mocks/media";
import { MemoryPipelineStore } from "../../mocks/memory-store";
import { jsonReplyStream, openaiSequence } from "../../mocks/openai";
import { server } from "../../mocks/server";

const WORKSPACE_ID = "0b6c1e2d-3f4a-4b5c-8d9e-0f1a2b3c4d5e";
const PIPELINE_ID = "6f0c2b1e-8d4a-4c3b-9e2f-1a2b3c4d5e6f";

describe("miniatures en image", () => {
  it("décrit le concept, son texte exact, sa place et ses couleurs", () => {
    const concept = (validThumbnails as Thumbnails).concepts[0] as ThumbnailConcept;
    const prompt = thumbnailPrompt(concept);
    expect(prompt).toContain(concept.imagePrompt);
    expect(prompt).toContain(`"${concept.textOverlay.text}"`);
    expect(prompt).toContain(concept.textOverlay.colorHex);
    expect(prompt).toMatch(/No other text, no logos, no watermark/);
  });

  it("génère une image par concept, la range sous le workspace et additionne leur coût", async () => {
    const images = new FakeImages();
    const storage = new MemoryMediaStorage();
    const { content, costUsdMicros } = await renderThumbnailImages(
      validThumbnails as Thumbnails,
      { workspaceId: WORKSPACE_ID, pipelineId: PIPELINE_ID, generationId: "gen-1" },
      { openai: images as unknown as OpenAIClient, storage, model: "gpt-image-2" },
    );
    expect(images.prompts).toHaveLength(validThumbnails.concepts.length);
    expect(content.concepts.map((c) => c.imagePath)).toEqual(
      validThumbnails.concepts.map((_, i) => `${WORKSPACE_ID}/${PIPELINE_ID}/thumbnails/gen-1-${i + 1}.jpg`),
    );
    expect(storage.files.get(content.concepts[0]!.imagePath!)?.contentType).toBe("image/jpeg");
    expect(costUsdMicros).toBe(validThumbnails.concepts.length * (100 * 5 + 6000 * 30));
  });

  it("garde sans image un concept refusé par la modération, sans faire échouer les autres", async () => {
    const refused = (validThumbnails as Thumbnails).concepts[1]!.imagePrompt;
    const images = new FakeImages((prompt) => prompt.includes(refused));
    const { content } = await renderThumbnailImages(
      validThumbnails as Thumbnails,
      { workspaceId: WORKSPACE_ID, pipelineId: PIPELINE_ID, generationId: "gen-1" },
      { openai: images as unknown as OpenAIClient, storage: new MemoryMediaStorage(), model: "gpt-image-2" },
    );
    expect(content.concepts[1]!.imagePath).toBeUndefined();
    expect(content.concepts.filter((c) => c.imagePath)).toHaveLength(validThumbnails.concepts.length - 1);
  });

  it("refuse un segment de chemin qui sortirait du dossier du pipeline", () => {
    expect(() => mediaPath(WORKSPACE_ID, PIPELINE_ID, "..", "x.jpg")).toThrow(/invalide/);
    expect(() => mediaPath(WORKSPACE_ID, PIPELINE_ID, "a/b.jpg")).toThrow(/invalide/);
  });

  it("generateAsset laisse les concepts sans image sur un plan sans images HD", async () => {
    const store = new MemoryPipelineStore();
    store.addPipeline({ id: PIPELINE_ID, workspaceId: WORKSPACE_ID, brief: validBrief as Brief, channel: null, tier: "standard" });
    store.seedVersion(PIPELINE_ID, "script", validScript);
    store.seedVersion(PIPELINE_ID, "titles", validTitles);
    server.use(openaiSequence(() => jsonReplyStream(validThumbnails, { model: "gpt-4o-mini-2024-07-18" })).handler);
    const images = new FakeImages();
    const versionId = await generateAsset(PIPELINE_ID, "thumbnails", {
      store,
      client: new Client({ apiKey: "test-key", maxRetries: 0 }),
      images: { openai: images as unknown as OpenAIClient, storage: new MemoryMediaStorage(), model: "gpt-image-2" },
    });
    expect(images.prompts).toHaveLength(0);
    expect((store.versions.find((v) => v.id === versionId)!.content as Thumbnails).concepts.every((c) => !c.imagePath)).toBe(true);
    expect(store.generation(`pipe:${PIPELINE_ID}:thumbnails`).credits).toBe(1);
  });

  it("generateAsset ajoute les images aux miniatures enregistrées, et leur coût à la télémétrie", async () => {
    const store = new MemoryPipelineStore();
    store.addPipeline({ id: PIPELINE_ID, workspaceId: WORKSPACE_ID, brief: { ...validBrief, thumbnailImages: true } as Brief, channel: null, tier: "standard" });
    store.seedVersion(PIPELINE_ID, "script", validScript);
    store.seedVersion(PIPELINE_ID, "titles", validTitles);
    server.use(openaiSequence(() => jsonReplyStream(validThumbnails, { model: "gpt-4o-mini-2024-07-18", usage: { prompt_tokens: 1000, completion_tokens: 100 } })).handler);
    const images = new FakeImages();
    const storage = new MemoryMediaStorage();

    const versionId = await generateAsset(PIPELINE_ID, "thumbnails", {
      store,
      client: new Client({ apiKey: "test-key", maxRetries: 0 }),
      images: { openai: images as unknown as OpenAIClient, storage, model: "gpt-image-2" },
    });

    const version = store.versions.find((v) => v.id === versionId)!;
    expect((version.content as Thumbnails).concepts.every((c) => c.imagePath && storage.files.has(c.imagePath))).toBe(true);
    const textCost = Math.round(1000 * 0.15 + 100 * 0.6);
    expect(store.generation(`pipe:${PIPELINE_ID}:thumbnails`).telemetry!.costUsdMicros).toBe(textCost + images.prompts.length * (100 * 5 + 6000 * 30));
  });
});
