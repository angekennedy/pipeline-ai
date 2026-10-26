import { ChannelPresetSchema, type ChannelPreset } from "@/lib/ai/schemas";

// Lecture du formulaire d'un preset de chaîne (Server Action) : FormData → preset validé par
// ChannelPresetSchema, et l'inverse pour préremplir l'édition.

export const CHANNEL_FORM_FIELDS = [
  "name",
  "niche",
  "defaultLanguage",
  "tone",
  "style",
  "audience",
  "voiceGender",
  "voiceAge",
  "voiceAccent",
  "voicePace",
  "bannedWords",
  "ctaTemplate",
  "thumbnailPalette",
] as const;
export type ChannelFormField = (typeof CHANNEL_FORM_FIELDS)[number];
export type ChannelFormValues = Partial<Record<ChannelFormField, string>>;

// Champs en erreur ; le formulaire affiche le message de chacun (ChannelForm.errors).
export type ChannelFieldErrors = Partial<Record<ChannelFormField, true>>;

export type ChannelFormResult =
  | { ok: true; preset: ChannelPreset; values: ChannelFormValues }
  | { ok: false; fieldErrors: ChannelFieldErrors; values: ChannelFormValues };

// Une liste saisie en texte : séparée par des virgules ou des retours à la ligne, sans doublon.
const list = (value: string | undefined) => [...new Set((value ?? "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean))];
const optional = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);

// Chemin d'une erreur Zod → champ du formulaire.
function fieldOf(path: PropertyKey[]): ChannelFormField {
  const [head, key] = path;
  if (head === "voiceProfile") return `voice${String(key).charAt(0).toUpperCase()}${String(key).slice(1)}` as ChannelFormField;
  if (head === "brandRules") return key as ChannelFormField;
  return head as ChannelFormField;
}

export function parseChannelForm(data: FormData): ChannelFormResult {
  const values = Object.fromEntries(
    CHANNEL_FORM_FIELDS.flatMap((field) => {
      const value = data.get(field);
      return typeof value === "string" ? [[field, value]] : [];
    }),
  ) as ChannelFormValues;

  const result = ChannelPresetSchema.safeParse({
    name: values.name,
    niche: values.niche,
    defaultLanguage: values.defaultLanguage,
    tone: optional(values.tone),
    style: optional(values.style),
    audience: optional(values.audience),
    voiceProfile: {
      gender: optional(values.voiceGender),
      age: optional(values.voiceAge),
      accent: optional(values.voiceAccent),
      pace: optional(values.voicePace),
    },
    brandRules: {
      bannedWords: list(values.bannedWords),
      ctaTemplate: optional(values.ctaTemplate),
      thumbnailPalette: list(values.thumbnailPalette).map((color) => color.toUpperCase()),
    },
  });
  if (result.success) return { ok: true, preset: result.data, values };

  const fieldErrors: ChannelFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = fieldOf(issue.path);
    fieldErrors[field] = true;
  }
  return { ok: false, fieldErrors, values };
}

export function presetToFormValues(preset: ChannelPreset): ChannelFormValues {
  return {
    name: preset.name,
    niche: preset.niche,
    defaultLanguage: preset.defaultLanguage,
    tone: preset.tone ?? "",
    style: preset.style ?? "",
    audience: preset.audience ?? "",
    voiceGender: preset.voiceProfile.gender ?? "",
    voiceAge: preset.voiceProfile.age ?? "",
    voiceAccent: preset.voiceProfile.accent ?? "",
    voicePace: preset.voiceProfile.pace ?? "",
    bannedWords: preset.brandRules.bannedWords.join(", "),
    ctaTemplate: preset.brandRules.ctaTemplate ?? "",
    thumbnailPalette: preset.brandRules.thumbnailPalette.join(", "),
  };
}

// Preset proposé dans le formulaire de brief : de quoi le nommer et préremplir le brief.
export type ChannelOption = { id: string; name: string } & Pick<ChannelPreset, "niche" | "defaultLanguage" | "tone" | "style" | "audience">;

export const channelOption = ({ id, preset }: { id: string; preset: ChannelPreset }): ChannelOption => ({
  id,
  name: preset.name,
  niche: preset.niche,
  defaultLanguage: preset.defaultLanguage,
  tone: preset.tone,
  style: preset.style,
  audience: preset.audience,
});

// Champs du brief préremplis au choix d'un preset. Ton, style et public ne sont remplacés que si le
// preset les fixe : sinon la saisie en cours est gardée.
export function briefPrefill(option: ChannelOption): Record<string, string> {
  return {
    niche: option.niche,
    language: option.defaultLanguage,
    ...(option.tone && { tone: option.tone }),
    ...(option.style && { style: option.style }),
    ...(option.audience && { targetAudience: option.audience }),
  };
}
