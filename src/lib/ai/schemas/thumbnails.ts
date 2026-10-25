import { z } from "zod";

// Sans drapeau `i` : le motif est transmis tel quel dans le JSON Schema, qui ne connaît pas les drapeaux.
export const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const MAX_OVERLAY_WORDS = 4;
// Chaque mot séparé par un espace compte, petits mots compris (« de », « à », « the »).
export const overlayWords = (text: string) => text.trim().split(/\s+/u).length;
// Message précis pour la réparation : le modèle voit le texte fautif et son nombre de mots.
const overlayMessage = (text: string) => `« ${text} » compte ${overlayWords(text)} mots : ${MAX_OVERLAY_WORDS} au maximum`;

const OverlayText = z
  .string()
  .max(30)
  .superRefine((text, ctx) => {
    if (overlayWords(text) > MAX_OVERLAY_WORDS) ctx.addIssue({ code: "custom", message: overlayMessage(text) });
  });

const concept = (text: z.ZodType<string>) =>
  z.object({
    pairedTitleIndex: z.number().int().min(0), // la miniature complète ce titre, sans le répéter
    imagePrompt: z.string().max(1200),
    negativePrompt: z.string().max(400),
    composition: z.string().max(300),
    focalEmotion: z.string().max(40),
    textOverlay: z.object({
      text,
      placement: z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "center"]),
      colorHex: HexColor,
      strokeHex: HexColor,
      fontStyle: z.enum(["bold-sans", "condensed", "handwritten", "serif-impact"]),
    }),
    aspectRatio: z.literal("16:9"),
  });

export const ThumbnailConceptSchema = concept(OverlayText);

// Contrat stocké (et éditions manuelles) : chaque texte tient en 4 mots.
export const ThumbnailsSchema = z.object({
  concepts: z.array(ThumbnailConceptSchema).min(3).max(4),
});

// Sortie du modèle : un concept au texte trop long est toléré, puis écarté par le post-traitement,
// tant qu'il en reste 3 utilisables. Sinon, la réparation ne porte que sur les concepts fautifs.
export const ThumbnailsOutputSchema = z
  .object({ concepts: z.array(concept(z.string().max(30))).min(3).max(4) })
  .superRefine((thumbnails, ctx) => {
    const usable = thumbnails.concepts.filter(({ textOverlay }) => overlayWords(textOverlay.text) <= MAX_OVERLAY_WORDS);
    if (usable.length >= 3) return;
    thumbnails.concepts.forEach(({ textOverlay }, i) => {
      if (overlayWords(textOverlay.text) > MAX_OVERLAY_WORDS) {
        ctx.addIssue({ code: "custom", path: ["concepts", i, "textOverlay", "text"], message: overlayMessage(textOverlay.text) });
      }
    });
  });

export type ThumbnailConcept = z.infer<typeof ThumbnailConceptSchema>;
export type Thumbnails = z.infer<typeof ThumbnailsSchema>;
