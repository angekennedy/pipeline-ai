import { MAX_LINE, MAX_LINES, type Cue } from "@/lib/export/srt";
import type { Alignment } from "@/lib/media/elevenlabs";

// Sous-titres calés sur la voix réelle : le minutage par caractère d'ElevenLabs donne le début et la
// fin de chaque mot. Mêmes règles que l'export texte (2 lignes de 42 caractères au plus, une phrase
// ne partage pas un sous-titre avec la suivante), plus une durée maximale par sous-titre.

const MAX_CUE_MS = 6000;
const SENTENCE_END = /[.!?…]["»”)]*$/;

export type TimedWord = { text: string; startMs: number; endMs: number };

export function wordsOf(alignment: Alignment, offsetMs = 0): TimedWord[] {
  const words: TimedWord[] = [];
  let current: TimedWord | null = null;
  alignment.characters.forEach((char, i) => {
    const startMs = offsetMs + Math.round(alignment.character_start_times_seconds[i]! * 1000);
    const endMs = offsetMs + Math.round(alignment.character_end_times_seconds[i]! * 1000);
    if (/\s/.test(char)) {
      if (current) words.push(current);
      current = null;
      return;
    }
    if (current) {
      current.text += char;
      current.endMs = endMs;
    } else {
      current = { text: char, startMs, endMs };
    }
  });
  if (current) words.push(current);
  return words;
}

// Regroupe les mots en sous-titres d'au plus MAX_LINES lignes de MAX_LINE caractères.
export function wordsToCues(words: TimedWord[]): Cue[] {
  const cues: Cue[] = [];
  let lines: string[] = [];
  let first: TimedWord | null = null;
  let last: TimedWord | null = null;

  const flush = () => {
    if (first && last && lines.length) cues.push({ startMs: first.startMs, endMs: Math.max(last.endMs, first.startMs + 1), lines });
    lines = [];
    first = last = null;
  };

  for (const word of words) {
    const line = lines.at(-1);
    const fitsLine = line !== undefined && `${line} ${word.text}`.length <= MAX_LINE;
    const tooLong = first !== null && word.endMs - first.startMs > MAX_CUE_MS;
    if (tooLong || (!fitsLine && lines.length === MAX_LINES)) flush();

    const current = lines.at(-1);
    if (current !== undefined && `${current} ${word.text}`.length <= MAX_LINE) lines[lines.length - 1] = `${current} ${word.text}`;
    else lines.push(word.text);
    first ??= word;
    last = word;
    if (SENTENCE_END.test(word.text)) flush();
  }
  flush();

  // Pas de chevauchement : un sous-titre finit au plus tard au début du suivant.
  for (let i = 0; i < cues.length - 1; i++) cues[i]!.endMs = Math.min(cues[i]!.endMs, cues[i + 1]!.startMs);
  return cues;
}
