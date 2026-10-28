import type { Language, Script } from "@/lib/ai/schemas";
import { countWords, WORDS_PER_MINUTE } from "@/lib/pipeline/postprocess/timing";

// Durée de la vidéo d'un script, en minutes entières (au moins 1) : la voix lit toute la narration.
// Base du coût réservé au lancement de la vidéo (videoCreditsFor).
export function videoMinutesOf(script: Pick<Script, "scenes">, language: Language): number {
  const words = script.scenes.reduce((sum, scene) => sum + countWords(scene.narration), 0);
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE[language]));
}
