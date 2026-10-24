import { describe, expect, it } from "vitest";
import { ScriptSchema } from "@/lib/ai/schemas/script";
import { validScript } from "../../fixtures/assets";

const script = () => structuredClone(validScript);

describe("ScriptSchema", () => {
  it("accepte un script valide", () => {
    expect(ScriptSchema.safeParse(script()).success).toBe(true);
  });

  it("exige au moins 3 scènes", () => {
    const s = script();
    s.scenes = s.scenes.slice(0, 2);
    expect(ScriptSchema.safeParse(s).success).toBe(false);
  });

  it("rejette une narration trop courte", () => {
    const s = script();
    s.scenes[0]!.narration = "Trop court.";
    expect(ScriptSchema.safeParse(s).success).toBe(false);
  });

  it("rejette un rôle de scène inconnu", () => {
    const s = script() as { scenes: Array<{ purpose: string }> };
    s.scenes[0]!.purpose = "intro";
    expect(ScriptSchema.safeParse(s).success).toBe(false);
  });

  it("rejette un texte à l'écran de plus de 60 caractères", () => {
    const s = script();
    s.scenes[0]!.onScreenText = "x".repeat(61);
    expect(ScriptSchema.safeParse(s).success).toBe(false);
  });

  it("exige des index de scènes consécutifs à partir de 1", () => {
    const s = script();
    s.scenes[2]!.index = 5;
    const result = ScriptSchema.safeParse(s);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["scenes", 2, "index"]);
  });

  it("rejette un point de vérification qui pointe vers une scène inexistante", () => {
    const s = script();
    s.factCheckFlags = [{ sceneIndex: 9, claim: "Affirmation" }];
    const result = ScriptSchema.safeParse(s);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["factCheckFlags", 0, "sceneIndex"]);
  });
});
