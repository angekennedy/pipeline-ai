import { afterEach, describe, expect, it, vi } from "vitest";

async function loadServerEnv() {
  vi.resetModules();
  return (await import("@/lib/env/server")).serverEnv;
}

describe("serverEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("expose les secrets serveur", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    await expect(loadServerEnv()).resolves.toMatchObject({
      SUPABASE_SECRET_KEY: "sb_secret_test",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });
  });

  it("laisse les surcharges de modèles facultatives", async () => {
    const env = await loadServerEnv();
    expect(env.MODEL_SCRIPT_STANDARD).toBeUndefined();
  });

  it.each(["SUPABASE_SECRET_KEY", "ANTHROPIC_API_KEY"])("échoue si %s manque", async (name) => {
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

  it.each(["production", "preview"])("exige les clés Inngest et Stripe sur Vercel (%s)", async (vercelEnv) => {
    vi.stubEnv("VERCEL_ENV", vercelEnv);
    vi.stubEnv("INNGEST_SIGNING_KEY", "signkey-test");
    await expect(loadServerEnv()).rejects.toThrow(/INNGEST_EVENT_KEY/);

    vi.stubEnv("INNGEST_EVENT_KEY", "event-key-test");
    await expect(loadServerEnv()).rejects.toThrow(/STRIPE_SECRET_KEY/);

    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_cle");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_secret");
    await expect(loadServerEnv()).resolves.toMatchObject({ INNGEST_SIGNING_KEY: "signkey-test", INNGEST_EVENT_KEY: "event-key-test", STRIPE_SECRET_KEY: "sk_test_cle" });
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
