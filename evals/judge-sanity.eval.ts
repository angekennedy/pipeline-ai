import { describe, expect, it } from "vitest";
import type { Brief, Script } from "@/lib/ai/schemas";
import { judgePipeline } from "./lib/judge";
import type { PipelineOutput } from "./lib/checks";
import { validScript } from "../tests/fixtures/assets";

// Contre-exemples du juge (eval-audit §4) : chacun doit obtenir une note basse. Trois appels payants
// au modèle juge ; ne tourne que si EVAL_JUDGE_SANITY=1.
const volcanoes: Brief = { niche: "Géologie", topic: "Les volcans d'Islande, entre feu et glace", language: "fr", tone: "dramatic", durationMinutes: 3, style: "documentary" };
const scenes = (narration: string): Script["scenes"] =>
  (validScript as Script).scenes.map((scene) => ({ ...scene, narration, title: "Scène", visualDirection: "Plan fixe" }));
const pipeline = (script: Script): PipelineOutput => ({ brief: volcanoes, assets: { script }, failures: {} });

const NEGATIVES: Array<[string, Script]> = [
  ["narration vide de sens", { ...(validScript as Script), workingTitle: "Titre", hookSummary: "Résumé", scenes: scenes("Texte texte texte texte texte texte texte."), callToAction: "Abonnez-vous." }],
  ["« je ne sais pas »", { ...(validScript as Script), workingTitle: "Je ne sais pas", hookSummary: "Je ne sais pas.", scenes: scenes("Je ne sais pas quoi dire sur ce sujet, désolé."), callToAction: "Je ne sais pas." }],
  ["script assuré sur un autre sujet (les pyramides au lieu des volcans)", validScript as Script],
];

describe.runIf(process.env.EVAL_JUDGE_SANITY === "1")("juge : contre-exemples", () => {
  it.each(NEGATIVES)("%s obtient au plus 2/5", async (_, script) => {
    const result = await judgePipeline(pipeline(script));
    console.log(`${_} : ${result.grade.judge.toFixed(2)}/5, ${result.explanation.judge}`);
    expect(result.grade.judge).toBeLessThanOrEqual(2);
  });
});
