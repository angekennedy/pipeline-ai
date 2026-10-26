import { z } from "zod";

export const TitleVariantSchema = z.object({
  title: z.string().min(10).max(100), // limite YouTube : 100 caractères
  angle: z.enum(["curiosity_gap", "number", "negative", "how_to", "question", "story", "authority", "urgency"]),
  rationale: z.string().max(200),
  heuristicScore: z.number().min(1).max(10), // affiché comme heuristique, pas comme une prédiction de CTR
  charCount: z.number().int(), // recalculé par recountTitles()
});

export const TitlesSchema = z
  .object({
    variants: z.array(TitleVariantSchema).min(5).max(10),
    recommendedIndex: z.number().int().min(0),
  })
  .superRefine((titles, ctx) => {
    if (titles.recommendedIndex >= titles.variants.length) {
      ctx.addIssue({ code: "custom", path: ["recommendedIndex"], message: "Variante inexistante" });
    }
  });

export type TitleVariant = z.infer<typeof TitleVariantSchema>;
export type Titles = z.infer<typeof TitlesSchema>;
