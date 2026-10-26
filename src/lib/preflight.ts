import type { LegalEntity } from "./legal";

// Vérifications avant la mise en production (tâche 5.5, docs/runbook.md) : ce que la validation de
// l'environnement ne bloque pas au build, mais qui doit être prêt le jour du lancement. Seuls des noms
// de variables et de champs sont rapportés, jamais une valeur.
// Sans import d'exécution : le script `pnpm preflight` charge ce fichier avec Node directement.

export type Check = { id: string; ok: boolean; blocking: boolean; detail?: string };

type Env = Record<string, string | undefined>;

const present = (env: Env, key: string) => Boolean(env[key]?.trim());

export function preflightChecks(env: Env, entity: LegalEntity): Check[] {
  const missingLegal = Object.entries(entity)
    .filter(([, value]) => !value?.trim())
    .map(([key]) => key);
  const siteUrl = env.NEXT_PUBLIC_SITE_URL ?? "";
  const missing = (keys: string[]) => keys.filter((key) => !present(env, key));
  const list = (keys: string[]) => (keys.length ? keys.join(", ") : undefined);

  const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "ANTHROPIC_API_KEY", "INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY"];
  return [
    { id: "env.required", ok: missing(required).length === 0, blocking: true, detail: list(missing(required)) },
    { id: "stripe.live", ok: Boolean(env.STRIPE_SECRET_KEY?.startsWith("sk_live_")), blocking: true, detail: "STRIPE_SECRET_KEY" },
    { id: "stripe.webhook", ok: Boolean(env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")), blocking: true, detail: "STRIPE_WEBHOOK_SECRET" },
    { id: "stripe.terms", ok: env.STRIPE_TERMS_CONSENT === "required", blocking: true, detail: "STRIPE_TERMS_CONSENT=required" },
    { id: "legal.entity", ok: missingLegal.length === 0, blocking: true, detail: list(missingLegal) },
    { id: "site.url", ok: siteUrl.startsWith("https://"), blocking: true, detail: "NEXT_PUBLIC_SITE_URL (https://…)" },
    { id: "admin.emails", ok: present(env, "ADMIN_EMAILS"), blocking: false, detail: "ADMIN_EMAILS" },
    { id: "sentry.dsn", ok: present(env, "NEXT_PUBLIC_SENTRY_DSN"), blocking: false, detail: "NEXT_PUBLIC_SENTRY_DSN" },
    { id: "posthog.key", ok: Boolean(env.POSTHOG_KEY?.startsWith("phc_")), blocking: false, detail: "POSTHOG_KEY" },
    // Les seuils par défaut (200 $ et 25 $ par jour) conviennent au lancement, mais doivent être un choix.
    { id: "spend.limits", ok: present(env, "SPEND_DAILY_LIMIT_USD") && present(env, "SPEND_DAILY_WORKSPACE_LIMIT_USD"), blocking: false, detail: "SPEND_DAILY_LIMIT_USD, SPEND_DAILY_WORKSPACE_LIMIT_USD" },
  ];
}

export const blockingFailures = (checks: Check[]) => checks.filter((check) => check.blocking && !check.ok);
