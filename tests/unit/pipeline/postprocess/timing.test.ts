import { describe, expect, it } from "vitest";
import { LANGUAGES } from "@/lib/ai/schemas/brief";
import type { Script } from "@/lib/ai/schemas/script";
import {
  DURATION_TOLERANCE,
  WORDS_PER_MINUTE,
  applyTiming,
  countWords,
  estimateSeconds,
} from "@/lib/pipeline/postprocess/timing";
import { validScript } from "../../../fixtures/assets";

const words = (n: number) => Array.from({ length: Math.floor(n) }, () => "mot").join(" ");

function scriptWithNarrations(...wordCounts: number[]): Script {
  const s = structuredClone(validScript) as Script;
  s.scenes = wordCounts.map((n, i) => ({ ...s.scenes[0]!, index: i + 1, narration: words(n), estimatedSeconds: 999 }));
  return s;
}

describe("countWords", () => {
  it.each([
    ["Bonjour le monde", 3],
    ["  Bonjour\n\tle   monde  ", 3],
    ["Il — était , une fois !", 4],
    ["L'ouvrier soulève aujourd'hui 2,5 tonnes", 5],
    ["", 0],
    ["   ", 0],
  ])("%j contient %i mots", (text, expected) => {
    expect(countWords(text)).toBe(expected);
  });
});

describe("estimateSeconds", () => {
  it("définit un débit pour chaque langue supportée", () => {
    expect(Object.keys(WORDS_PER_MINUTE).sort()).toEqual([...LANGUAGES].sort());
  });

  it("convertit les mots en secondes selon le débit de la langue", () => {
    expect(estimateSeconds(words(WORDS_PER_MINUTE.fr), "fr")).toBe(60);
    expect(estimateSeconds(words(WORDS_PER_MINUTE.de * 2), "de")).toBe(120);
  });

  it("arrondit à la seconde la plus proche", () => {
    // 10 mots à 150 mots/min = 4 s
    expect(estimateSeconds(words(10), "fr")).toBe(4);
  });

  it("compte au moins 1 seconde pour une narration non vide", () => {
    expect(estimateSeconds("Oui", "fr")).toBe(1);
  });

  it("compte 0 seconde pour un texte vide", () => {
    expect(estimateSeconds("", "fr")).toBe(0);
  });
});

describe("applyTiming", () => {
  const wpm = WORDS_PER_MINUTE.fr;

  it("remplace les durées estimées par le modèle par le calcul en code", () => {
    const { script } = applyTiming(scriptWithNarrations(wpm, wpm / 2, wpm), { language: "fr", durationMinutes: 3 });
    expect(script.scenes.map((s) => s.estimatedSeconds)).toEqual([60, 30, 60]);
  });

  it("calcule la durée totale et l'écart avec la cible", () => {
    const result = applyTiming(scriptWithNarrations(wpm, wpm, wpm), { language: "fr", durationMinutes: 4 });
    expect(result.totalSeconds).toBe(180);
    expect(result.targetSeconds).toBe(240);
    expect(result.deviation).toBeCloseTo(-0.25);
    expect(result.withinTolerance).toBe(false);
  });

  it(`tolère un écart de ±${DURATION_TOLERANCE * 100} %`, () => {
    // Cible de 180 s dans les trois cas.
    expect(applyTiming(scriptWithNarrations(wpm, wpm, wpm), { language: "fr", durationMinutes: 3 }).withinTolerance).toBe(true);
    const slightlyLong = scriptWithNarrations(wpm * 1.15, wpm, wpm); // 69 + 60 + 60 = 189 s, soit +5 %
    expect(applyTiming(slightlyLong, { language: "fr", durationMinutes: 3 }).withinTolerance).toBe(true);
    const tooLong = scriptWithNarrations(wpm * 2, wpm, wpm); // 240 s, soit +33 %
    expect(applyTiming(tooLong, { language: "fr", durationMinutes: 3 }).withinTolerance).toBe(false);
  });

  it("accepte exactement la borne de tolérance", () => {
    // 2 × 69 s = 138 s pour une cible de 120 s : +15 % pile
    const result = applyTiming(scriptWithNarrations(wpm * 1.15, wpm * 1.15), { language: "fr", durationMinutes: 2 });
    expect(result.deviation).toBeCloseTo(DURATION_TOLERANCE);
    expect(result.withinTolerance).toBe(true);
  });

  it("ne modifie pas le script d'origine", () => {
    const original = scriptWithNarrations(wpm, wpm, wpm);
    applyTiming(original, { language: "fr", durationMinutes: 3 });
    expect(original.scenes[0]!.estimatedSeconds).toBe(999);
  });
});
