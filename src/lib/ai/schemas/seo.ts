import { z } from "zod";

export const ChapterSchema = z.object({ timestamp: z.string(), title: z.string() });

export const SeoSchema = z.object({
  description: z.string().max(5000), // les 150 premiers caractères servent d'accroche
  tags: z.array(z.string().max(30)).max(30), // limite de 500 caractères au total appliquée par normalizeTags()
  hashtags: z.array(z.string().regex(/^#\p{L}[\p{L}\p{N}_]*$/u)).max(3),
  // Le modèle choisit où commencent les chapitres ; les horodatages sont calculés par buildChapters().
  chapterTitles: z.array(z.object({ startsAtSceneIndex: z.number().int().min(1), title: z.string().max(60) })).min(3),
  chapters: z.array(ChapterSchema).optional(),
});

export type Chapter = z.infer<typeof ChapterSchema>;
export type Seo = z.infer<typeof SeoSchema>;
