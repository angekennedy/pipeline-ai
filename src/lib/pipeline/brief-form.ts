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
] as const;
export type BriefFormField = (typeof BRIEF_FORM_FIELDS)[number];

// Un message par champ, compréhensible sans connaître les règles du schéma.
export const BRIEF_FIELD_MESSAGES: Record<BriefFormField, string> = {
  niche: "Indiquez la niche de la chaîne, en 2 à 80 caractères.",
  topic: "Décrivez le sujet de la vidéo, en 5 à 300 caractères.",
  language: "Choisissez une langue dans la liste.",
  tone: "Choisissez un ton dans la liste.",
  style: "Choisissez un style dans la liste.",
  durationMinutes: "La durée est un nombre entier de minutes, de 1 à 60.",
  targetAudience: "Décrivez le public en 200 caractères au plus.",
  extraNotes: "Les consignes tiennent en 2 000 caractères au plus.",
  tier: "Choisissez la formule Standard ou Premium.",
};

const BriefFormSchema = BriefSchema.omit({ channelId: true }).extend({
  tier: z.enum(["standard", "premium"]),
});

export type BriefFormValues = Partial<Record<BriefFormField, string>>;

export type BriefFormResult =
  | { ok: true; brief: Brief; tier: ModelTier; values: BriefFormValues }
  | { ok: false; fieldErrors: Partial<Record<BriefFormField, string>>; values: BriefFormValues };

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
    tier: values.tier ?? "standard",
  });

  if (result.success) {
    const { tier, ...brief } = result.data;
    return { ok: true, brief, tier, values };
  }
  const fieldErrors: Partial<Record<BriefFormField, string>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as BriefFormField;
    fieldErrors[field] = BRIEF_FIELD_MESSAGES[field];
  }
  return { ok: false, fieldErrors, values };
}
