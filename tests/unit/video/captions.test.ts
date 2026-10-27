import { describe, expect, it } from "vitest";
import { MAX_LINE } from "@/lib/export/srt";
import { wordsOf, wordsToCues } from "@/lib/video/captions";
import { regularAlignment } from "../../mocks/media";

describe("sous-titres calés sur la voix", () => {
  it("retrouve chaque mot avec son début et sa fin, décalés du début de la scène", () => {
    expect(wordsOf(regularAlignment("Le ciel bleu."), 1000)).toEqual([
      { text: "Le", startMs: 1000, endMs: 1100 },
      { text: "ciel", startMs: 1150, endMs: 1350 },
      { text: "bleu.", startMs: 1400, endMs: 1650 },
    ]);
  });

  it("coupe à la fin de chaque phrase et ne chevauche jamais le sous-titre suivant", () => {
    const cues = wordsToCues(wordsOf(regularAlignment("Le ciel est bleu. Pourquoi ? Grâce à la lumière.")));
    expect(cues.map((cue) => cue.lines.join(" "))).toEqual(["Le ciel est bleu.", "Pourquoi ?", "Grâce à la lumière."]);
    expect(cues[0]).toMatchObject({ startMs: 0 });
    for (let i = 0; i < cues.length - 1; i++) expect(cues[i]!.endMs).toBeLessThanOrEqual(cues[i + 1]!.startMs);
  });

  it("tient en 2 lignes de 42 caractères au plus et 6 s au plus", () => {
    const sentence = Array.from({ length: 40 }, (_, i) => `mot${i}`).join(" ");
    const cues = wordsToCues(wordsOf(regularAlignment(sentence, 0.08)));
    expect(cues.length).toBeGreaterThan(2);
    for (const cue of cues) {
      expect(cue.lines.length).toBeLessThanOrEqual(2);
      for (const line of cue.lines) expect(line.length).toBeLessThanOrEqual(MAX_LINE);
      expect(cue.endMs - cue.startMs).toBeLessThanOrEqual(6000);
    }
  });
});
