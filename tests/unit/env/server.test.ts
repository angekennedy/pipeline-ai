import { afterEach, describe, expect, it, vi } from "vitest";

async function loadServerEnv() {
  vi.resetModules();
  return (await import("@/lib/env/server")).serverEnv;
}

describe("serverEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("expose les secrets serveur", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    vi.stubEnv("OPENAI_API_KEY", "sk-proj-test");
    await expect(loadServerEnv()).resolves.toMatchObject({
      SUPABASE_SECRET_KEY: "sb_secret_test",
      OPENAI_API_KEY: "sk-proj-test",
    });
  });

  it("retire les espaces autour de OPENAI_API_KEY", async () => {
    vi.stubEnv("OPENAI_API_KEY", "  sk-proj-test\n");
    await expect(loadServerEnv()).resolves.toMatchObject({ OPENAI_API_KEY: "sk-proj-test" });
  });

  it.each([
    ["une apostrophe courbe", "sk-proj-ab’cd"],
    ["un espace interne", "sk-proj-ab cd"],
    ["un caractère accentué", "sk-proj-abécd"],
  ])("refuse une OPENAI_API_KEY avec %s, sans afficher la valeur", async (_, value) => {
    vi.stubEnv("OPENAI_API_KEY", value);
    const error = await loadServerEnv().catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/OPENAI_API_KEY/);
    expect((error as Error).message).toMatch(/Caractère invalide/);
    expect((error as Error).message).not.toContain(value);
  });

  it("laisse les surcharges de modèles facultatives", async () => {
    const env = await loadServerEnv();
    expect(env.MODEL_SCRIPT_STANDARD).toBeUndefined();
  });

  it.each(["SUPABASE_SECRET_KEY", "OPENAI_API_KEY"])("échoue si %s manque", async (name) => {
    vi.stubEnv(name, "");
    await expect(loadServerEnv()).rejects.toThrow();
  });

  it("fixe des seuils de dépense par défaut, surchargeables, et refuse un seuil nul", async () => {
    await expect(loadServerEnv()).resolves.toMatchObject({ SPEND_DAILY_LIMIT_USD: 200, SPEND_DAILY_WORKSPACE_LIMIT_USD: 25 });
    vi.stubEnv("SPEND_DAILY_WORKSPACE_LIMIT_USD", "7.5");
    await expect(loadServerEnv()).resolves.toMatchObject({ SPEND_DAILY_WORKSPACE_LIMIT_USD: 7.5 });
    vi.stubEnv("SPEND_DAILY_LIMIT_USD", "0");
    await expect(loadServerEnv()).rejects.toThrow(/SPEND_DAILY_LIMIT_USD/);
  });

  it("ne demande pas les clés Inngest hors de Vercel", async () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    const env = await loadServerEnv();
    expect(env.INNGEST_SIGNING_KEY).toBeUndefined();
  });

  it.each([
    ["production", "sk_live_cle"],
    ["preview", "sk_test_cle"],
  ])("exige les clés Inngest et Stripe sur Vercel (%s)", async (vercelEnv, stripeKey) => {
    vi.stubEnv("VERCEL_ENV", vercelEnv);
    vi.stubEnv("INNGEST_SIGNING_KEY", "signkey-test");
    await expect(loadServerEnv()).rejects.toThrow(/INNGEST_EVENT_KEY/);

    vi.stubEnv("INNGEST_EVENT_KEY", "event-key-test");
    await expect(loadServerEnv()).rejects.toThrow(/STRIPE_SECRET_KEY/);

    vi.stubEnv("STRIPE_SECRET_KEY", stripeKey);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_secret");
    await expect(loadServerEnv()).resolves.toMatchObject({ INNGEST_SIGNING_KEY: "signkey-test", INNGEST_EVENT_KEY: "event-key-test", STRIPE_SECRET_KEY: stripeKey });
  });

  it("refuse une clé Stripe de test en production, et une clé live sur une preview", async () => {
    vi.stubEnv("INNGEST_SIGNING_KEY", "signkey-test");
    vi.stubEnv("INNGEST_EVENT_KEY", "event-key-test");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_secret");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_cle");
    await expect(loadServerEnv()).rejects.toThrow(/Clé live \(sk_live_\) attendue en production/);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_cle");
    await expect(loadServerEnv()).rejects.toThrow(/Clé de test \(sk_test_\) attendue sur une preview/);
    vi.stubEnv("VERCEL_ENV", undefined); // local : les deux modes sont permis
    await expect(loadServerEnv()).resolves.toMatchObject({ STRIPE_SECRET_KEY: "sk_live_cle" });
  });

  it("n'accepte que « required » pour la case à cocher des CGU de Stripe", async () => {
    vi.stubEnv("STRIPE_TERMS_CONSENT", "required");
    await expect(loadServerEnv()).resolves.toMatchObject({ STRIPE_TERMS_CONSENT: "required" });
    vi.stubEnv("STRIPE_TERMS_CONSENT", "oui");
    await expect(loadServerEnv()).rejects.toThrow(/STRIPE_TERMS_CONSENT/);
  });

  it("refuse une clé Stripe qui n'en est pas une", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "pk_test_publique");
    await expect(loadServerEnv()).rejects.toThrow(/STRIPE_SECRET_KEY/);
  });
});

describe("variables vides", () => {
  it("traite une clé Stripe vide comme absente", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const env = await loadServerEnv();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.STRIPE_WEBHOOK_SECRET).toBeUndefined();
  });
});
