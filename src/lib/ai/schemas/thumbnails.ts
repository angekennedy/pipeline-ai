import { z } from "zod";

// Sans drapeau `i` : le motif est transmis tel quel dans le JSON Schema, qui ne connaît pas les drapeaux.
export const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const ThumbnailConceptSchema = z.object({
  pairedTitleIndex: z.number().int().min(0), // la miniature complète ce titre, sans le répéter
  imagePrompt: z.string().max(1200),
  negativePrompt: z.string().max(400),
  composition: z.string().max(300),
  focalEmotion: z.string().max(40),
  textOverlay: z.object({
    text: z
      .string()
      .max(30)
      .refine((s) => s.trim().split(/\s+/u).length <= 4, "4 mots maximum"),
    placement: z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "center"]),
    colorHex: HexColor,
    strokeHex: HexColor,
    fontStyle: z.enum(["bold-sans", "condensed", "handwritten", "serif-impact"]),
  }),
  aspectRatio: z.literal("16:9"),
});

export const ThumbnailsSchema = z.object({
  concepts: z.array(ThumbnailConceptSchema).min(3).max(4),
});

export type ThumbnailConcept = z.infer<typeof ThumbnailConceptSchema>;
export type Thumbnails = z.infer<typeof ThumbnailsSchema>;
