import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { Brief, Script, Seo, Thumbnails, Titles, Voiceover } from "@/lib/ai/schemas";
import { mediaEntries, pipelineToZipStream } from "@/lib/export/document";
import { emptyPipelineView, type PipelineView } from "@/lib/pipeline/view";
import type { VideoManifest } from "@/lib/video/manifest";
import { tFr } from "../../fixtures/i18n";
import { validBrief, validScript, validSeo, validThumbnails, validTitles, validVoiceover } from "../../fixtures/assets";

const manifest: VideoManifest = {
  url: "https://cdn.shotstack.test/render-1.mp4",
  renderId: "render-1",
  durationSeconds: 61,
  captionsPath: "ws/pipe/video/gen/captions.srt",
  voice: [
    { sceneIndex: 1, path: "ws/pipe/video/gen/voice-1.mp3", start: 0, duration: 30 },
    { sceneIndex: 2, path: "ws/pipe/video/gen/voice-2.mp3", start: 30.4, duration: 30.6 },
  ],
  shots: [1, 2, 3, 4].map((n) => ({ sceneIndex: n <= 2 ? 1 : 2, start: (n - 1) * 15, length: 15, imagePath: `ws/pipe/video/gen/shot-${n}.jpg`, prompt: `plan ${n}` })),
  sandbox: false,
};

function view({ video = true, images = true } = {}): PipelineView {
  const base = emptyPipelineView({ id: "4d1f7c3e-2b6a-4f8e-9c0d-1a2b3c4d5e6f", brief: { ...validBrief, video } as Brief, tier: "standard", createdAt: "2026-10-26T08:00:00.000Z" });
  const thumbnails = {
    concepts: (validThumbnails as Thumbnails).concepts.map((concept, i) => ({ ...concept, ...(images && { imagePath: `ws/pipe/thumbnails/gen-${i + 1}.jpg` }) })),
  };
  const content = { script: validScript as Script, titles: validTitles as Titles, seo: validSeo as Seo, voiceover: validVoiceover as Voiceover, thumbnails };
  for (const [type, value] of Object.entries(content)) base.assets[type as keyof typeof content] = { ...base.assets[type as keyof typeof content], status: "ready", content: value as never };
  return { ...base, status: "completed", ...(video && { video: { status: "ready", content: manifest, error: null } }) };
}

const read = async (stream: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(stream).arrayBuffer());

describe("export avec médias", () => {
  it("liste les miniatures, puis les sous-titres, voix et plans de la vidéo prête", () => {
    const names = mediaEntries(view()).map((entry) => entry.name);
    expect(names.slice(0, validThumbnails.concepts.length)).toEqual(validThumbnails.concepts.map((_, i) => `miniatures/miniature-${i + 1}.jpg`));
    expect(names).toContain("video/sous-titres-video.srt");
    expect(names).toContain("video/voix-off/scene-02.mp3");
    expect(names).toContain("video/images/plan-004.jpg");
  });

  it("ne joint rien sans image ni vidéo prête", () => {
    expect(mediaEntries(view({ video: false, images: false }))).toEqual([]);
  });

  it("produit en flux une archive avec les textes, les médias lus dans le stockage et le lien du MP4", async () => {
    const read_: string[] = [];
    const files = unzipSync(
      await read(
        pipelineToZipStream(view(), tFr, async (path) => {
          read_.push(path);
          return new TextEncoder().encode(`contenu de ${path}`);
        }),
      ),
    );
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["LISEZ-MOI.txt", "pipeline.md", "script.txt", "video/lien-video.txt", "miniatures/miniature-1.jpg", "video/images/plan-001.jpg"]));
    expect(strFromU8(files["video/images/plan-003.jpg"]!)).toBe("contenu de ws/pipe/video/gen/shot-3.jpg");
    expect(strFromU8(files["video/lien-video.txt"]!)).toContain("https://cdn.shotstack.test/render-1.mp4");
    // Le LISEZ-MOI liste aussi les médias.
    expect(strFromU8(files["LISEZ-MOI.txt"]!)).toContain("- video/voix-off/scene-01.mp3");
    expect(read_).toHaveLength(mediaEntries(view()).length);
  });

  it("interrompt le flux si un média est illisible", async () => {
    const stream = pipelineToZipStream(view(), tFr, async () => {
      throw new Error("objet introuvable");
    });
    await expect(read(stream)).rejects.toThrow(/objet introuvable/);
  });
});
