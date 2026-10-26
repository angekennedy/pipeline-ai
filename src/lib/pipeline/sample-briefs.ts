import type { Language } from "@/lib/ai/schemas";
import type { BriefFormValues } from "./brief-form";

// Briefs d'exemple de l'onboarding (tâche 5.4) : un clic remplit le formulaire, un second lance la
// génération. Vidéos de 3 min, en Standard : à l'évaluation, un brief de cette durée se génère en
// moins d'une minute (evals/report, es-ciencia-cielo), et coûte peu de crédits du plan Free.
// Niche et sujet sont des messages (Onboarding.samples), dans la langue de l'interface, qui devient
// aussi celle de la vidéo.

export const SAMPLE_BRIEFS = {
  vikings: { tone: "mysterious", style: "documentary" },
  sky: { tone: "educational", style: "explainer" },
  octopus: { tone: "educational", style: "storytelling" },
} as const;

export type SampleBriefKey = keyof typeof SAMPLE_BRIEFS;
export const SAMPLE_BRIEF_KEYS = Object.keys(SAMPLE_BRIEFS) as SampleBriefKey[];
export const SAMPLE_DURATION_MINUTES = 3;

export const isSampleBrief = (value: unknown): value is SampleBriefKey => typeof value === "string" && Object.hasOwn(SAMPLE_BRIEFS, value);

export function sampleBriefValues(key: SampleBriefKey, text: { niche: string; topic: string }, language: Language): BriefFormValues {
  const { tone, style } = SAMPLE_BRIEFS[key];
  // Champs facultatifs vidés : un exemple remplace toute saisie précédente, preset compris.
  return {
    niche: text.niche,
    topic: text.topic,
    language,
    tone,
    style,
    durationMinutes: String(SAMPLE_DURATION_MINUTES),
    tier: "standard",
    targetAudience: "",
    extraNotes: "",
    channelId: "",
  };
}
