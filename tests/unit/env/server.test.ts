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

  it("ne demande pas les clés Inngest hors de Vercel", async () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    const env = await loadServerEnv();
    expect(env.INNGEST_SIGNING_KEY).toBeUndefined();
  });

  it.each(["production", "preview"])("exige les clés Inngest sur Vercel (%s)", async (vercelEnv) => {
    vi.stubEnv("VERCEL_ENV", vercelEnv);
    vi.stubEnv("INNGEST_SIGNING_KEY", "signkey-test");
    await expect(loadServerEnv()).rejects.toThrow(/INNGEST_EVENT_KEY/);

    vi.stubEnv("INNGEST_EVENT_KEY", "event-key-test");
    await expect(loadServerEnv()).resolves.toMatchObject({ INNGEST_SIGNING_KEY: "signkey-test", INNGEST_EVENT_KEY: "event-key-test" });
  });
});
