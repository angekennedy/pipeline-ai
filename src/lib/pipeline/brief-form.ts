import { z } from "zod";
import { BriefSchema, type Brief } from "@/lib/ai/schemas";
import type { ModelTier } from "./registry";

// Lecture du formulaire de brief (Server Action) : FormData → brief validé par BriefSchema.

export const BRIEF_FORM_FIELDS = [
  "niche",
  "topic",
  "language",
  "tone",
  "style",
  "durationMinutes",
  "targetAudience",
  "extraNotes",
  "tier",
  "channelId",
] as const;
export type BriefFormField = (typeof BRIEF_FORM_FIELDS)[number];


const BriefFormSchema = BriefSchema.extend({
  tier: z.enum(["standard", "premium"]),
});

export type BriefFormValues = Partial<Record<BriefFormField, string>>;
// Champs en erreur ; le formulaire affiche le message de chacun (BriefForm.errors), compréhensible sans
// connaître les règles du schéma.
export type BriefFieldErrors = Partial<Record<BriefFormField, true>>;

export type BriefFormResult =
  | { ok: true; brief: Brief; tier: ModelTier; values: BriefFormValues }
  | { ok: false; fieldErrors: BriefFieldErrors; values: BriefFormValues };

const text = (data: FormData, field: BriefFormField) => {
  const value = data.get(field);
  return typeof value === "string" ? value : undefined;
};

export function parseBriefForm(data: FormData): BriefFormResult {
  const values = Object.fromEntries(
    BRIEF_FORM_FIELDS.flatMap((field) => {
      const value = text(data, field);
      return value === undefined ? [] : [[field, value]];
    }),
  ) as BriefFormValues;

  const optional = (value: string | undefined) => (value?.trim() ? value : undefined);
  const duration = values.durationMinutes?.trim();
  const result = BriefFormSchema.safeParse({
    ...values,
    // Number("") vaut 0 et Number("7.5") 7,5 : la validation entière du schéma tranche.
    durationMinutes: duration ? Number(duration) : undefined,
    targetAudience: optional(values.targetAudience),
    extraNotes: optional(values.extraNotes),
    channelId: optional(values.channelId), // « Aucun preset » envoie une chaîne vide
    tier: values.tier ?? "standard",
  });

  if (result.success) {
    const { tier, ...brief } = result.data;
    return { ok: true, brief, tier, values };
  }
  const fieldErrors: BriefFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as BriefFormField;
    fieldErrors[field] = true;
  }
  return { ok: false, fieldErrors, values };
}

// Duplication d'un brief (tableau de bord) : brief enregistré → saisie du formulaire, preset compris.
export function briefToFormValues(brief: Brief, tier: ModelTier): BriefFormValues {
  return {
    niche: brief.niche,
    topic: brief.topic,
    language: brief.language,
    tone: brief.tone,
    style: brief.style,
    durationMinutes: String(brief.durationMinutes),
    targetAudience: brief.targetAudience ?? "",
    extraNotes: brief.extraNotes ?? "",
    tier,
    channelId: brief.channelId ?? "",
  };
}
