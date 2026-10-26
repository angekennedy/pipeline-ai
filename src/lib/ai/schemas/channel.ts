import { z } from "zod";
import { LANGUAGES, STYLES, TONES } from "./brief";
import { HexColor } from "./thumbnails";

// Copie du preset de chaîne figée dans `pipelines.channel_snapshot` à la création du pipeline.
// Saisi par les membres du workspace : non fiable, toujours encadré par renderUntrusted().
export const ChannelPresetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  niche: z.string().trim().min(2).max(80),
  defaultLanguage: z.enum(LANGUAGES),
  tone: z.enum(TONES).optional(),
  style: z.enum(STYLES).optional(),
  audience: z.string().trim().max(200).optional(),
  voiceProfile: z
    .object({
      gender: z.enum(["male", "female", "neutral"]).optional(),
      age: z.string().max(20).optional(),
      accent: z.string().max(60).optional(),
      pace: z.enum(["slow", "medium", "fast"]).optional(),
    })
    .default({}),
  brandRules: z
    .object({
      bannedWords: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
      ctaTemplate: z.string().trim().max(300).optional(),
      thumbnailPalette: z.array(HexColor).max(6).default([]),
    })
    .default({ bannedWords: [], thumbnailPalette: [] }),
});

export type ChannelPreset = z.infer<typeof ChannelPresetSchema>;
