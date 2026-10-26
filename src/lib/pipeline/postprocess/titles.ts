import type { Titles } from "@/lib/ai/schemas/titles";

// Compte en points de code : un emoji simple vaut 1 caractère.
export function recountTitles(titles: Titles): Titles {
  return {
    ...titles,
    variants: titles.variants.map((variant) => ({ ...variant, charCount: [...variant.title].length })),
  };
}
