import type { Brief, ChannelPreset } from "@/lib/ai/schemas";

// Influence du preset de chaîne sur les titres (tâche 2.5). Les mots interdits sont tirés des titres
// d'un premier passage sans preset : ceux que le modèle choisit spontanément. On compte ensuite les
// titres qui les emploient dans un second passage sans preset (témoin) et dans un passage avec.

export const BANNED_WORDS = 3;
const MIN_LENGTH = 5; // écarte articles, prépositions et mots-outils, dans toutes les langues du brief

// Minuscules, sans accents : « Mystère » et « mystere » sont le même mot.
const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const words = (text: string) => normalize(text).match(/\p{L}+/gu) ?? [];

// Mots les plus fréquents des titres, présents dans au moins deux titres, hors sujet et niche du brief
// (les interdire rendrait le sujet impossible à nommer).
export function pickBannedWords(titles: string[], brief: Pick<Brief, "topic" | "niche">, count = BANNED_WORDS): string[] {
  const exclude = new Set(words(`${brief.topic} ${brief.niche}`));
  const frequency = new Map<string, number>();
  for (const title of titles) {
    for (const word of new Set(words(title))) {
      if (word.length >= MIN_LENGTH && !exclude.has(word)) frequency.set(word, (frequency.get(word) ?? 0) + 1);
    }
  }
  return [...frequency]
    .filter(([, n]) => n >= 2)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, count)
    .map(([word]) => word);
}

// Titres qui emploient au moins un mot interdit, en mot entier.
export function titlesWithBannedWords(titles: string[], banned: string[]): number {
  const forbidden = new Set(banned.map(normalize));
  return titles.filter((title) => words(title).some((word) => forbidden.has(word))).length;
}

// Preset minimal qui ne change que les mots interdits : l'écart mesuré vient de lui seul.
export const evalPreset = (brief: Brief, bannedWords: string[]): ChannelPreset => ({
  name: "Chaîne d'évaluation",
  niche: brief.niche,
  defaultLanguage: brief.language,
  voiceProfile: {},
  brandRules: { bannedWords, thumbnailPalette: [] },
});

export type PresetCaseResult = {
  id: string;
  banned: string[];
  control: { titles: number; withBanned: number };
  preset: { titles: number; withBanned: number };
};

// Taux de titres employant un mot interdit, témoin contre preset, sur l'ensemble des cas.
export function summarize(results: PresetCaseResult[]) {
  const rate = (side: "control" | "preset") => {
    const titles = results.reduce((sum, r) => sum + r[side].titles, 0);
    return titles === 0 ? 0 : results.reduce((sum, r) => sum + r[side].withBanned, 0) / titles;
  };
  return { cases: results.length, controlRate: rate("control"), presetRate: rate("preset") };
}
