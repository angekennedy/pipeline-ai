import type { Script, Voiceover } from "@/lib/ai/schemas";

// Texte à faire lire par une voix de synthèse (ElevenLabs ou autre), à coller tel quel : uniquement
// des mots prononcés et de la ponctuation. Aucune balise : un moteur qui ne les comprend pas les
// lirait à voix haute.
// - Pause notée [pause:600ms] dans la voix off : points de suspension, qui marquent un temps de
//   silence dans tous les moteurs.
// - Changement de segment : paragraphe.
// - Tout autre crochet, chevron ou marque de mise en forme est retiré.

const PAUSE = /\s*\[pause:\s*\d+\s*ms\]\s*/gi;

export function spokenText(text: string): string {
  return text
    .replace(PAUSE, "… ")
    .replace(/<[^>]*>|\[[^\]]*\]/g, " ") // balises et crochets restants
    .replace(/[*_#`~]/g, "") // mise en forme Markdown
    .replace(/…\s*([.!?…,;:])/g, "…") // « … . » après une pause en fin de phrase
    .replace(/[ \t]+/g, " ")
    .replace(/ ([,.;:!?…])/g, "$1")
    .trim();
}

// Voix off complète, scène par scène : un paragraphe par segment.
export const voiceoverSpokenText = (voiceover: Voiceover) =>
  voiceover.segments
    .toSorted((a, b) => a.sceneIndex - b.sceneIndex)
    .map((segment) => spokenText(segment.text))
    .filter(Boolean)
    .join("\n\n");

// Sans voix off (échec ou asset sauté), la narration du script en tient lieu.
export const scriptSpokenText = (script: Script) =>
  script.scenes
    .map((scene) => spokenText(scene.narration))
    .filter(Boolean)
    .join("\n\n");
