import { z } from "zod";

export const VoiceoverSegmentSchema = z.object({
  sceneIndex: z.number().int().min(1),
  text: z.string(), // narration nettoyée, pauses notées [pause:600ms]
  pace: z.enum(["slow", "medium", "fast"]),
  emotion: z.string().max(40),
  emphasisWords: z.array(z.string()).max(6),
  pauseAfterMs: z.number().int().min(0).max(3000),
  pronunciationHints: z.array(z.object({ word: z.string(), phonetic: z.string() })).max(10),
  providerPrompt: z.string().max(500), // indications libres pour ElevenLabs ou un autre TTS
});

export const VoiceoverSchema = z
  .object({
    globalVoice: z.object({
      gender: z.enum(["male", "female", "neutral"]),
      age: z.string(),
      accent: z.string(),
      baseStyle: z.string().max(200),
    }),
    segments: z.array(VoiceoverSegmentSchema).min(1),
  })
  .superRefine((voiceover, ctx) => {
    const seen = new Set<number>();
    voiceover.segments.forEach((segment, i) => {
      if (seen.has(segment.sceneIndex)) {
        ctx.addIssue({ code: "custom", path: ["segments", i, "sceneIndex"], message: "Scène déjà couverte" });
      }
      seen.add(segment.sceneIndex);
    });
  });

export type VoiceoverSegment = z.infer<typeof VoiceoverSegmentSchema>;
export type Voiceover = z.infer<typeof VoiceoverSchema>;
