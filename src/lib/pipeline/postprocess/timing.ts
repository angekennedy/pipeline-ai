import type { Brief, Language } from "@/lib/ai/schemas/brief";
import type { Script } from "@/lib/ai/schemas/script";

// Débit de narration moyen d'une voix off, en mots par minute. À calibrer sur des voix réelles.
export const WORDS_PER_MINUTE: Record<Language, number> = {
  fr: 150,
  en: 155,
  es: 160,
  pt: 155,
  de: 135,
  it: 150,
};

// Écart maximal toléré entre la durée estimée et la durée cible (±15 %).
export const DURATION_TOLERANCE = 0.15;

// Un mot est un groupe sans espace qui contient au moins une lettre ou un chiffre :
// la ponctuation isolée (« — », « , ») n'est pas lue.
export function countWords(text: string): number {
  return text.split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export function estimateSeconds(text: string, language: Language): number {
  const words = countWords(text);
  if (words === 0) return 0;
  return Math.max(1, Math.round((words * 60) / WORDS_PER_MINUTE[language]));
}

export type TimingResult = {
  script: Script;
  totalSeconds: number;
  targetSeconds: number;
  deviation: number; // (total - cible) / cible
  withinTolerance: boolean;
};

export function applyTiming(script: Script, brief: Pick<Brief, "language" | "durationMinutes">): TimingResult {
  const scenes = script.scenes.map((scene) => ({
    ...scene,
    estimatedSeconds: estimateSeconds(scene.narration, brief.language),
  }));
  const totalSeconds = scenes.reduce((sum, scene) => sum + scene.estimatedSeconds, 0);
  const targetSeconds = brief.durationMinutes * 60;
  const deviation = (totalSeconds - targetSeconds) / targetSeconds;

  return {
    script: { ...script, scenes },
    totalSeconds,
    targetSeconds,
    deviation,
    withinTolerance: Math.abs(deviation) <= DURATION_TOLERANCE,
  };
}
