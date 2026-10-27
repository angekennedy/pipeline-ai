import "server-only";
import { z } from "zod";

// Secrets serveur. Ne jamais préfixer ces variables par NEXT_PUBLIC_.
const ServerEnvSchema = z
  .object({
    SUPABASE_SECRET_KEY: z.string().min(1),
    // Envoyée dans l'en-tête `authorization`, qui n'accepte que du Latin-1 : une apostrophe courbe
    // collée depuis un éditeur ferait échouer chaque appel. Espaces de bord retirés, ASCII imprimable
    // exigé. Le message d'erreur ne reprend jamais la valeur.
    OPENAI_API_KEY: z
      .string()
      .trim()
      .min(1)
      // i18n-ignore : message de démarrage, lu dans les logs de build, jamais affiché aux utilisateurs.
      .regex(/^[\x21-\x7E]+$/, "Caractère invalide (apostrophe courbe, espace ou caractère accentué ?) : recopiez la clé depuis platform.openai.com"),
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
    // « required » : case à cocher des CGU dans Stripe Checkout (tâche 5.5). Demande l'URL des CGU
    // dans le Dashboard Stripe (Paramètres → Public) ; sans elle, Stripe refuse la session.
    STRIPE_TERMS_CONSENT: z.enum(["required"]).optional(),
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
    // Mode Stripe selon l'environnement (tâche 5.5) : jamais de clé live sur une preview, jamais de
    // clé de test en production.
    const mode = env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "live" : "test";
    if (env.STRIPE_SECRET_KEY && env.VERCEL_ENV === "production" && mode !== "live") {
      ctx.addIssue({ code: "custom", path: ["STRIPE_SECRET_KEY"], message: "Clé live (sk_live_) attendue en production" });
    }
    if (env.STRIPE_SECRET_KEY && env.VERCEL_ENV === "preview" && mode === "live") {
      ctx.addIssue({ code: "custom", path: ["STRIPE_SECRET_KEY"], message: "Clé de test (sk_test_) attendue sur une preview" });
    }
  });

// Une variable vide vaut une variable absente (désactivation explicite, comme pour Stripe en e2e).
export const serverEnv = ServerEnvSchema.parse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== "")));
