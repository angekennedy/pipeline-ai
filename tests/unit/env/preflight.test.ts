import { describe, expect, it } from "vitest";
import { LEGAL_ENTITY, type LegalEntity } from "@/lib/legal";
import { blockingFailures, preflightChecks } from "@/lib/preflight";

// Vérifications avant la mise en production (tâche 5.5, `pnpm preflight`).
const entity: LegalEntity = Object.fromEntries(Object.keys(LEGAL_ENTITY).map((key) => [key, `valeur ${key}`])) as LegalEntity;
const ready = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
  ANTHROPIC_API_KEY: "sk-ant-x",
  INNGEST_SIGNING_KEY: "signkey-prod-x",
  INNGEST_EVENT_KEY: "event-x",
  STRIPE_SECRET_KEY: "sk_live_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  STRIPE_TERMS_CONSENT: "required",
  NEXT_PUBLIC_SITE_URL: "https://pipeline.example",
  ADMIN_EMAILS: "ops@pipeline.example",
  NEXT_PUBLIC_SENTRY_DSN: "https://k@o.ingest.sentry.io/1",
  POSTHOG_KEY: "phc_x",
  SPEND_DAILY_LIMIT_USD: "200",
  SPEND_DAILY_WORKSPACE_LIMIT_USD: "25",
};

describe("preflightChecks", () => {
  it("valide une production complète", () => {
    const checks = preflightChecks(ready, entity);
    expect(checks.every((check) => check.ok)).toBe(true);
    expect(blockingFailures(checks)).toEqual([]);
  });

  it("bloque sur une clé Stripe de test, sans case CGU, sans éditeur ni URL publique", () => {
    const failures = blockingFailures(
      preflightChecks({ ...ready, STRIPE_SECRET_KEY: "sk_test_x", STRIPE_TERMS_CONSENT: undefined, NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }, { ...entity, publisher: null, phone: " " }),
    );
    expect(failures.map((check) => [check.id, check.detail])).toEqual([
      ["stripe.live", "STRIPE_SECRET_KEY"],
      ["stripe.terms", "STRIPE_TERMS_CONSENT=required"],
      ["legal.entity", "publisher, phone"],
      ["site.url", "NEXT_PUBLIC_SITE_URL (https://…)"],
    ]);
  });

  it("liste les variables requises absentes, et seulement avertit pour l'admin, Sentry, PostHog et les seuils", () => {
    const checks = preflightChecks({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" }, entity);
    expect(checks.find((check) => check.id === "env.required")?.detail).toBe("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, ANTHROPIC_API_KEY, INNGEST_SIGNING_KEY, INNGEST_EVENT_KEY");
    const warnings = checks.filter((check) => !check.ok && !check.blocking).map((check) => check.id);
    expect(warnings).toEqual(["admin.emails", "sentry.dsn", "posthog.key", "spend.limits"]);
  });

  it("ne rapporte jamais une valeur, seulement des noms", () => {
    const report = JSON.stringify(preflightChecks({ ...ready, STRIPE_SECRET_KEY: "sk_test_secret_a_ne_pas_afficher" }, entity));
    expect(report).not.toContain("secret_a_ne_pas_afficher");
    expect(report).not.toContain("valeur ");
  });
});
