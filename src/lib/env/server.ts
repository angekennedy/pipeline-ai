import "server-only";
import { z } from "zod";

// Secrets serveur. Ne jamais préfixer ces variables par NEXT_PUBLIC_.
// Les variables Stripe et Upstash seront ajoutées dans leurs phases respectives.
const ServerEnvSchema = z
  .object({
    SUPABASE_SECRET_KEY: z.string().min(1),
    ANTHROPIC_API_KEY: z.string().min(1),
    // Surcharges facultatives des modèles par défaut de src/lib/ai/models.ts.
    MODEL_SCRIPT_STANDARD: z.string().min(1).optional(),
    MODEL_SCRIPT_PREMIUM: z.string().min(1).optional(),
    MODEL_LIGHT: z.string().min(1).optional(),
    MODEL_EVAL_JUDGE: z.string().min(1).optional(),
    // Inngest Cloud, lues directement par le SDK. En local, `INNGEST_DEV=1` les remplace.
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    INNGEST_EVENT_KEY: z.string().min(1).optional(),
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(), // variable système de Vercel
  })
  // Déployé sur Vercel, sans ces clés, chaque appel d'Inngest échouerait : on bloque le build.
  .superRefine((env, ctx) => {
    if (env.VERCEL_ENV !== "production" && env.VERCEL_ENV !== "preview") return;
    for (const key of ["INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY"] as const) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `Requise sur Vercel (${env.VERCEL_ENV})` });
    }
  });

export const serverEnv = ServerEnvSchema.parse(process.env);
