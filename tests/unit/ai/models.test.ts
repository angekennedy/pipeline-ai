import { afterEach, describe, expect, it, vi } from "vitest";
import { PRICING } from "@/lib/ai/pricing";

async function load() {
  vi.resetModules();
  return import("@/lib/ai/models");
}

describe("modelFor", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("utilise gpt-4o pour le script, Standard et Premium, gpt-4o-mini pour les dérivés", async () => {
    const { modelFor } = await load();
    expect(modelFor("script.standard").id).toBe("gpt-4o");
    expect(modelFor("script.premium").id).toBe("gpt-4o");
    expect(modelFor("light").id).toBe("gpt-4o-mini");
  });

  it("a un tarif pour chaque modèle par défaut", async () => {
    const { MODEL_KEYS, modelFor } = await load();
    for (const key of MODEL_KEYS) expect(PRICING[modelFor(key).id]).toBeDefined();
  });

  it("accepte une surcharge par variable d'environnement", async () => {
    vi.stubEnv("MODEL_SCRIPT_PREMIUM", "gpt-4.1");
    const { modelFor } = await load();
    expect(modelFor("script.premium")).toEqual({ id: "gpt-4.1" });
    expect(modelFor("script.standard").id).toBe("gpt-4o");
  });
});
