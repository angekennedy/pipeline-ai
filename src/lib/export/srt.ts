import type { Script, Voiceover } from "@/lib/ai/schemas";
import { spokenText } from "./spoken";

// Sous-titres SRT de la narration, calés sur le minutage des scènes (applyTiming) : chaque scène
// commence là où finit la précédente, et son texte est réparti en sous-titres de 2 lignes de
// 42 caractères au plus (usage courant), sans chevauchement. La durée d'une scène est partagée entre
// ses sous-titres au prorata de leur longueur : une estimation, à recaler sur l'audio final.

export const MAX_LINE = 42;
export const MAX_LINES = 2;

export type Cue = { startMs: number; endMs: number; lines: string[] };

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
export function srtTimestamp(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(ms % 1000, 3)}`;
}

// Lignes de 42 caractères au plus, coupées entre les mots (un mot plus long reste entier).
function wrap(sentence: string): string[] {
  const lines: string[] = [];
  for (const word of sentence.split(/\s+/).filter(Boolean)) {
    const last = lines.at(-1);
    if (last !== undefined && `${last} ${word}`.length <= MAX_LINE) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

// Blocs de 2 lignes au plus ; une phrase ne partage pas un sous-titre avec la suivante.
function blocks(text: string): string[][] {
  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  return sentences.flatMap((sentence) => {
    const lines = wrap(sentence);
    const result: string[][] = [];
    for (let i = 0; i < lines.length; i += MAX_LINES) result.push(lines.slice(i, i + MAX_LINES));
    return result;
  });
}

export function scriptCues(script: Script, voiceover: Voiceover | null): Cue[] {
  const spoken = new Map(voiceover?.segments.map((segment) => [segment.sceneIndex, segment.text]) ?? []);
  const cues: Cue[] = [];
  let sceneStart = 0;
  for (const scene of script.scenes) {
    const sceneEnd = sceneStart + scene.estimatedSeconds * 1000;
    const parts = blocks(spokenText(spoken.get(scene.index) ?? scene.narration));
    const weights = parts.map((lines) => lines.join(" ").length);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let elapsed = 0;
    parts.forEach((lines, i) => {
      const startMs = sceneStart + Math.round(((sceneEnd - sceneStart) * elapsed) / total);
      elapsed += weights[i]!;
      const endMs = i === parts.length - 1 ? sceneEnd : sceneStart + Math.round(((sceneEnd - sceneStart) * elapsed) / total);
      if (endMs > startMs) cues.push({ startMs, endMs, lines });
    });
    sceneStart = sceneEnd;
  }
  return cues;
}

// Fichier SRT : numéro, horodatage `HH:MM:SS,mmm --> HH:MM:SS,mmm`, texte, ligne vide. Fins de ligne
// CRLF, les plus largement acceptées par les logiciels de montage et YouTube.
export const cuesToSrt = (cues: Cue[]) =>
  cues.map((cue, i) => [String(i + 1), `${srtTimestamp(cue.startMs)} --> ${srtTimestamp(cue.endMs)}`, ...cue.lines, ""].join("\r\n")).join("\r\n");

export const scriptToSrt = (script: Script, voiceover: Voiceover | null) => cuesToSrt(scriptCues(script, voiceover));
