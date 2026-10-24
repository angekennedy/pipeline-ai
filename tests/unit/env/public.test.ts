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
});
