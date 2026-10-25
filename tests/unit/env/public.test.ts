import { afterEach, describe, expect, it, vi } from "vitest";

async function loadPublicEnv() {
  vi.resetModules();
  return (await import("@/lib/env/public")).publicEnv;
}

describe("publicEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepte une configuration valide", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    await expect(loadPublicEnv()).resolves.toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    });
  });

  it("échoue si l'URL est invalide", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "pas-une-url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    await expect(loadPublicEnv()).rejects.toThrow();
  });

  it("échoue si la clé publique manque", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    await expect(loadPublicEnv()).rejects.toThrow();
  });

  it("accepte un DSN Sentry, facultatif, et refuse un DSN qui n'est pas une URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    expect((await loadPublicEnv()).NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();

    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://abc@o1.ingest.sentry.io/2");
    expect((await loadPublicEnv()).NEXT_PUBLIC_SENTRY_DSN).toBe("https://abc@o1.ingest.sentry.io/2");

    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "pas-un-dsn");
    await expect(loadPublicEnv()).rejects.toThrow();
  });
});
