// Limite YouTube : 500 caractères pour l'ensemble des tags.
export const TAGS_MAX_CHARS = 500;

// YouTube entoure de guillemets un tag qui contient un espace : 2 caractères de plus.
const tagCost = (tag: string) => [...tag].length + (tag.includes(" ") ? 2 : 0);

export function tagsCharCount(tags: string[]): number {
  return tags.reduce((sum, tag) => sum + tagCost(tag), 0) + Math.max(0, tags.length - 1);
}

const normalize = (tag: string) => tag.trim().replace(/^#+/, "").replace(/\s+/gu, " ").trim().toLowerCase();

// Normalise et déduplique dans l'ordre de pertinence proposé par le modèle.
// Un tag qui dépasse le budget est sauté, mais les suivants plus courts peuvent encore entrer.
export function normalizeTags(tags: string[]): string[] {
  const result: string[] = [];
  let used = 0;
  for (const tag of new Set(tags.map(normalize))) {
    if (!tag) continue;
    const cost = tagCost(tag) + (result.length > 0 ? 1 : 0);
    if (used + cost > TAGS_MAX_CHARS) continue;
    result.push(tag);
    used += cost;
  }
  return result;
}
