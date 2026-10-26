import "server-only";
import { z } from "zod";

// Secrets serveur. Ne jamais préfixer ces variables par NEXT_PUBLIC_.
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
    // Stripe (tâches 3.3 et 3.4). Absentes en local ou en CI : la facturation est indisponible, le
    // reste de l'application fonctionne. Clés de test (sk_test_) hors production.
    STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
    // Disjoncteur de dépense LLM (tâche 4.5), en dollars par jour UTC : au-delà, plus de nouvelle
    // génération (globale, ou du workspace) jusqu'au lendemain. Valeurs par défaut à ajuster en production.
    SPEND_DAILY_LIMIT_USD: z.coerce.number().positive().default(200),
    SPEND_DAILY_WORKSPACE_LIMIT_USD: z.coerce.number().positive().default(25),
    // Funnel PostHog (tâche 5.3), envoyé côté serveur. Absente : rien n'est envoyé. Région UE par défaut.
    POSTHOG_KEY: z.string().startsWith("phc_").optional(),
    POSTHOG_HOST: z.url().default("https://eu.i.posthog.com"),
    // Marge par pipeline (tâche 4.6) : les coûts LLM sont en dollars, les prix en euros.
    USD_TO_EUR: z.coerce.number().positive().default(0.92),
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(), // variable système de Vercel
  })
  // Déployé sur Vercel, sans ces clés, chaque appel d'Inngest ou de Stripe échouerait : on bloque le build.
  .superRefine((env, ctx) => {
    if (env.VERCEL_ENV !== "production" && env.VERCEL_ENV !== "preview") return;
    for (const key of ["INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `Requise sur Vercel (${env.VERCEL_ENV})` });
    }
  });

// Une variable vide vaut une variable absente (désactivation explicite, comme pour Stripe en e2e).
export const serverEnv = ServerEnvSchema.parse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== "")));
