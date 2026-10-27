import type { Brief, Scene } from "@/lib/ai/schemas";

// Découpage de la vidéo en plans : une image toutes les ~15 s, avec un zoom lent et un fondu entre
// deux plans. Le nombre de plans d'une scène suit la durée réelle de sa voix off ; chaque plan
// illustre la partie de la narration qu'il accompagne.

export const SHOT_SECONDS = 15;
// Respiration entre deux scènes, en secondes : la voix suivante démarre après ce silence.
export const SCENE_GAP_SECONDS = 0.4;

export type SceneVoice = { sceneIndex: number; duration: number };
export type PlannedShot = { sceneIndex: number; start: number; length: number; prompt: string };
export type SceneTiming = { sceneIndex: number; start: number; duration: number };

// Début de chaque scène sur la timeline, d'après la durée de sa voix.
export function sceneTimings(voices: SceneVoice[]): SceneTiming[] {
  let start = 0;
  return voices.map(({ sceneIndex, duration }) => {
    const timing = { sceneIndex, start, duration };
    start += duration + SCENE_GAP_SECONDS;
    return timing;
  });
}

// Phrases de la narration réparties en `count` parts de longueur voisine.
function narrationParts(narration: string, count: number): string[] {
  const sentences = narration.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const parts: string[][] = Array.from({ length: count }, () => []);
  const total = sentences.reduce((sum, s) => sum + s.length, 0) || 1;
  let elapsed = 0;
  for (const sentence of sentences) {
    const index = Math.min(count - 1, Math.floor((elapsed / total) * count));
    parts[index]!.push(sentence);
    elapsed += sentence.length;
  }
  return parts.map((part, i) => part.join(" ") || sentences.at(Math.min(i, sentences.length - 1)) || narration);
}

const STYLE_HINT: Record<Brief["style"], string> = {
  listicle: "dynamic editorial illustration",
  storytelling: "cinematic storytelling still",
  documentary: "documentary photograph, natural light",
  explainer: "clean explanatory visual, clear subject",
  "top-n": "bold editorial visual",
  "true-crime": "moody cinematic still, low-key lighting",
};

export function shotPrompt(brief: Pick<Brief, "style" | "tone">, scene: Pick<Scene, "visualDirection" | "bRollKeywords">, focus: string, shot: number): string {
  const keyword = scene.bRollKeywords.length ? scene.bRollKeywords[shot % scene.bRollKeywords.length] : null;
  return [
    `${STYLE_HINT[brief.style]} for a faceless YouTube video, ${brief.tone} mood, 16:9 landscape.`,
    `Scene direction: ${scene.visualDirection}`,
    keyword && `Main subject: ${keyword}.`,
    `It illustrates this narration: "${focus.slice(0, 400)}"`,
    "Photorealistic, high detail, professional color grading, sharp focus.",
    "No text, no letters, no captions, no logos, no watermark, no on-camera presenter, no split screen.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function planShots(
  brief: Pick<Brief, "style" | "tone">,
  scenes: Array<Pick<Scene, "index" | "narration" | "visualDirection" | "bRollKeywords">>,
  timings: SceneTiming[],
): PlannedShot[] {
  return timings.flatMap(({ sceneIndex, start, duration }) => {
    const scene = scenes.find((s) => s.index === sceneIndex);
    if (!scene) throw new Error(`Scène ${sceneIndex} absente du script`);
    // Le silence après la scène reste sur sa dernière image.
    const span = duration + SCENE_GAP_SECONDS;
    const count = Math.max(1, Math.round(duration / SHOT_SECONDS));
    const parts = narrationParts(scene.narration, count);
    return parts.map((focus, i) => ({
      sceneIndex,
      start: round(start + (span * i) / count),
      length: round(span / count),
      prompt: shotPrompt(brief, scene, focus, i),
    }));
  });
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;
