import { z } from "zod";

export const SceneSchema = z.object({
  index: z.number().int().min(1),
  purpose: z.enum(["hook", "context", "development", "twist", "payoff", "cta"]),
  title: z.string().max(80),
  narration: z.string().min(20), // texte lu par la voix off
  // B-roll, stock, motion design. Une ligne par plan voulu dans la vidéo (lib/video/shots).
  visualDirection: z.string().max(1000),
  bRollKeywords: z.array(z.string().max(40)).max(8),
  onScreenText: z.string().max(60).nullable(),
  estimatedSeconds: z.number().int().positive(), // remplacé par applyTiming() : le modèle ne compte pas
});

export const ScriptSchema = z
  .object({
    workingTitle: z.string().max(100),
    hookSummary: z.string().max(300),
    scenes: z.array(SceneSchema).min(3).max(80),
    callToAction: z.string().max(300),
    factCheckFlags: z.array(z.object({ sceneIndex: z.number().int(), claim: z.string() })).max(20),
  })
  .superRefine((script, ctx) => {
    script.scenes.forEach((scene, i) => {
      if (scene.index !== i + 1) {
        ctx.addIssue({ code: "custom", path: ["scenes", i, "index"], message: `Index attendu : ${i + 1}` });
      }
    });
    script.factCheckFlags.forEach((flag, i) => {
      if (flag.sceneIndex < 1 || flag.sceneIndex > script.scenes.length) {
        ctx.addIssue({ code: "custom", path: ["factCheckFlags", i, "sceneIndex"], message: "Scène inexistante" });
      }
    });
  });

export type Scene = z.infer<typeof SceneSchema>;
export type Script = z.infer<typeof ScriptSchema>;
