import { afterEach, describe, expect, it, vi } from "vitest";

// `server-only` lève une erreur hors d'un environnement React Server : neutralisé pour le test.
vi.mock("server-only", () => ({}));

async function loadServerEnv() {
  vi.resetModules();
  return (await import("@/lib/env/server")).serverEnv;
}

describe("serverEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("expose la clé secrète Supabase", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    await expect(loadServerEnv()).resolves.toEqual({ SUPABASE_SECRET_KEY: "sb_secret_test" });
  });

  it("échoue si la clé secrète manque", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    await expect(loadServerEnv()).rejects.toThrow();
  });
});
