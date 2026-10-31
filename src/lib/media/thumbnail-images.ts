import type { OpenAIClient } from "@/lib/ai/openai";
import { imageCostUsdMicros } from "@/lib/ai/pricing";
import type { ThumbnailConcept, Thumbnails } from "@/lib/ai/schemas";
import { isModerationBlocked } from "./moderation";
import { mediaPath, type MediaStorage } from "./storage";

// Miniatures en image : chaque concept (prompt, composition, texte incrusté) devient une image
// 16:9 en haute qualité, enregistrée dans le stockage des médias. YouTube affiche les miniatures en
// 1280×720 : 1536×864 laisse de la marge pour le recadrage.

export const IMAGE_SIZE = "1536x864" as const;

export type ImageDeps = { openai: OpenAIClient; storage: MediaStorage; model: string };

const PLACEMENT: Record<ThumbnailConcept["textOverlay"]["placement"], string> = {
  "top-left": "in the top-left corner",
  "top-right": "in the top-right corner",
  "bottom-left": "in the bottom-left corner",
  "bottom-right": "in the bottom-right corner",
  center: "centered",
};

const FONT: Record<ThumbnailConcept["textOverlay"]["fontStyle"], string> = {
  "bold-sans": "a heavy bold sans-serif",
  condensed: "a tall condensed sans-serif",
  handwritten: "a bold hand-painted brush",
  "serif-impact": "a heavy impact serif",
};

export function thumbnailPrompt(concept: ThumbnailConcept): string {
  const { textOverlay } = concept;
  return [
    "Professional YouTube thumbnail, 16:9, eye-catching, high contrast, sharp, readable at small size.",
    concept.imagePrompt,
    `Composition: ${concept.composition}. Emotion: ${concept.focalEmotion}.`,
    `Render the exact text "${textOverlay.text}" ${PLACEMENT[textOverlay.placement]}, in ${FONT[textOverlay.fontStyle]} font, color ${textOverlay.colorHex} with a thick ${textOverlay.strokeHex} outline. No other text, no logos, no watermark.`,
    concept.negativePrompt && `Avoid: ${concept.negativePrompt}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// Toutes les images en parallèle : 4 au plus, dans une seule étape du pipeline. Une image refusée par
// la modération d'OpenAI laisse son concept sans image (texte seul), sans faire échouer les autres.
export async function renderThumbnailImages(
  thumbnails: Thumbnails,
  { workspaceId, pipelineId, generationId }: { workspaceId: string; pipelineId: string; generationId: string },
  { openai, storage, model }: ImageDeps,
): Promise<{ content: Thumbnails; costUsdMicros: number | null }> {
  const results = await Promise.all(
    thumbnails.concepts.map(async (concept, i) => {
      const image = await openai
        .generateImage({ model, prompt: thumbnailPrompt(concept), size: IMAGE_SIZE, quality: "high", output_format: "jpeg", output_compression: 92 })
        .catch((error: unknown) => {
          if (isModerationBlocked(error)) return null;
          throw error;
        });
      if (!image) return { concept, cost: 0 };
      const imagePath = mediaPath(workspaceId, pipelineId, "thumbnails", `${generationId}-${i + 1}.jpg`);
      await storage.upload(imagePath, image.bytes, "image/jpeg");
      return { concept: { ...concept, imagePath }, cost: imageCostUsdMicros(model, image.usage) };
    }),
  );
  const costs = results.map((r) => r.cost);
  return {
    content: { ...thumbnails, concepts: results.map((r) => r.concept) },
    costUsdMicros: costs.some((cost) => cost === null) ? null : costs.reduce<number>((sum, cost) => sum + cost!, 0),
  };
}
