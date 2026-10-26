import type { Seo } from "@/lib/ai/schemas";
import { TAGS_MAX_CHARS, tagsCharCount } from "./postprocess/tags";

// Limites de YouTube Studio affichées à côté de chaque champ (tâche 4.3). `max` : refusé par YouTube ;
// `recommended` : au-delà, le texte est tronqué à l'affichage (titre dans le fil mobile, description
// dans les résultats de recherche).
export const YOUTUBE_LIMITS = {
  title: { max: 100, recommended: 70 },
  description: { max: 5000, preview: 150 },
  tags: { max: TAGS_MAX_CHARS },
  hashtags: { shown: 3 }, // affichés au-dessus du titre
} as const;

export type CounterStatus = "ok" | "warn" | "over";

// Caractères comptés comme YouTube : un emoji ou une lettre accentuée valent un caractère.
export const charLength = (text: string) => [...text].length;

export function counterStatus(count: number, { max, recommended }: { max: number; recommended?: number }): CounterStatus {
  if (count > max) return "over";
  if (recommended !== undefined && count > recommended) return "warn";
  return "ok";
}

export type SeoCounters = {
  description: { count: number; status: CounterStatus };
  preview: string; // début de la description visible dans les résultats de recherche
  tags: { count: number; status: CounterStatus };
  hashtags: { count: number; status: CounterStatus };
};

export function seoCounters(seo: Seo): SeoCounters {
  const description = charLength(seo.description);
  const tags = tagsCharCount(seo.tags);
  return {
    description: { count: description, status: counterStatus(description, { max: YOUTUBE_LIMITS.description.max }) },
    preview: [...seo.description].slice(0, YOUTUBE_LIMITS.description.preview).join(""),
    tags: { count: tags, status: counterStatus(tags, { max: YOUTUBE_LIMITS.tags.max }) },
    hashtags: { count: seo.hashtags.length, status: counterStatus(seo.hashtags.length, { max: YOUTUBE_LIMITS.hashtags.shown }) },
  };
}

export const titleCounter = (title: string) => {
  const count = charLength(title);
  return { count, status: counterStatus(count, YOUTUBE_LIMITS.title) };
};
