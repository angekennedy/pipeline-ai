import { z } from "zod";

export const LANGUAGES = ["fr", "en", "es", "pt", "de", "it"] as const;
export const TONES = ["educational", "dramatic", "humorous", "mysterious", "inspirational", "neutral"] as const;
export const STYLES = ["listicle", "storytelling", "documentary", "explainer", "top-n", "true-crime"] as const;

export const BriefSchema = z.object({
  niche: z.string().trim().min(2).max(80),
  topic: z.string().trim().min(5).max(300),
  language: z.enum(LANGUAGES),
  tone: z.enum(TONES),
  durationMinutes: z.number().int().min(1).max(60),
  style: z.enum(STYLES),
  targetAudience: z.string().trim().max(200).optional(),
  // Texte libre de l'utilisateur : non fiable, toujours encadré par renderUntrusted() dans les prompts.
  extraNotes: z.string().trim().max(2000).optional(),
  channelId: z.uuid().optional(),
  // Vidéo MP4 complète en fin de pipeline (images, voix off, sous-titres) : option payante, réservée
  // aux plans qui l'autorisent (PLANS.video). Absente : pipeline texte seul.
  video: z.boolean().optional(),
  // Miniatures en images HD : fixé par le serveur au lancement selon le plan (PLANS.thumbnailImages),
  // jamais lu dans le formulaire. Enregistré avec le brief : une régénération coûte le même prix.
  thumbnailImages: z.boolean().optional(),
});

export type Brief = z.infer<typeof BriefSchema>;
export type Language = Brief["language"];
