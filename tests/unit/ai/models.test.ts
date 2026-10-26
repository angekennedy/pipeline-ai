import { afterEach, describe, expect, it, vi } from "vitest";
import { PRICING } from "@/lib/ai/pricing";

async function load() {
  vi.resetModules();
  return import("@/lib/ai/models");
}

describe("modelFor", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("utilise Sonnet pour le script standard, Opus en Premium, Haiku pour les dérivés", async () => {
    const { modelFor } = await load();
    expect(modelFor("script.standard").id).toBe("claude-sonnet-5-5");
    expect(modelFor("script.premium").id).toBe("claude-opus-5-5");
    expect(modelFor("light").id).toBe("claude-haiku-5-5");
  });

  it("fixe explicitement un niveau d'effort pour chaque modèle", async () => {
    const { MODEL_KEYS, modelFor } = await load();
    for (const key of MODEL_KEYS) expect(["low", "medium", "high"]).toContain(modelFor(key).effort);
  });

  it("active le repli serveur sur refus pour Opus et Sonnet 5.5, pas pour Haiku", async () => {
    const { modelFor } = await load();
    expect(modelFor("script.standard").serverFallback).toBe(true);
    expect(modelFor("script.premium").serverFallback).toBe(true);
    expect(modelFor("light").serverFallback).toBe(false);
  });

  it("a un tarif pour chaque modèle par défaut", async () => {
    const { MODEL_KEYS, modelFor } = await load();
    for (const key of MODEL_KEYS) expect(PRICING[modelFor(key).id]).toBeDefined();
  });

  it("accepte une surcharge par variable d'environnement", async () => {
    vi.stubEnv("MODEL_LIGHT", "claude-sonnet-5-5");
    const { modelFor } = await load();
    expect(modelFor("light")).toMatchObject({ id: "claude-sonnet-5-5", serverFallback: true });
  });
});
