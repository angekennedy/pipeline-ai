import { describe, expect, it } from "vitest";
import { ScriptSchema, type Script } from "@/lib/ai/schemas";
import { applyScriptForm, NEW_SCENE, SCENE_ORDER_FIELD, sceneFieldName, scriptFieldErrors } from "@/lib/pipeline/script-form";
import { validScript } from "../../fixtures/assets";

const script = validScript as Script;
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("applyScriptForm", () => {
  it("applique les champs édités et garde le reste de la version courante", () => {
    const edited = applyScriptForm(
      script,
      form({
        workingTitle: "  Nouveau titre  ",
        [sceneFieldName(2, "narration")]: "Une narration\r\nsur deux lignes, réécrite à la main.",
        [sceneFieldName(1, "onScreenText")]: "",
        callToAction: "Abonnez-vous.",
      }),
    );
    expect(edited.workingTitle).toBe("Nouveau titre");
    expect(edited.scenes[1]!.narration).toBe("Une narration\nsur deux lignes, réécrite à la main.");
    expect(edited.scenes[0]!.onScreenText).toBeNull(); // champ vidé
    expect(edited.callToAction).toBe("Abonnez-vous.");
    // Non envoyés : inchangés.
    expect(edited.hookSummary).toBe(script.hookSummary);
    expect(edited.scenes[2]).toEqual(script.scenes[2]);
    expect(edited.scenes.map((s) => [s.purpose, s.bRollKeywords])).toEqual(script.scenes.map((s) => [s.purpose, s.bRollKeywords]));
    expect(edited.factCheckFlags).toEqual(script.factCheckFlags);
    expect(ScriptSchema.safeParse(edited).success).toBe(true);
  });
});

describe("applyScriptForm : scènes ajoutées, supprimées, déplacées", () => {
  it("suit l'ordre envoyé, renumérote et garde les points à vérifier des scènes restantes", () => {
    const flagged = { ...script, factCheckFlags: [{ sceneIndex: 2, claim: "2,5 tonnes" }, { sceneIndex: 3, claim: "150 mètres" }] };
    const narration = "Une scène ajoutée à la main, assez longue pour être lue.";
    // Scène 3 en tête, scène 2 supprimée, une scène ajoutée, puis les suivantes.
    const order = [3, 1, NEW_SCENE, ...script.scenes.slice(3).map((s) => s.index)];
    const edited = applyScriptForm(
      flagged,
      form({ [SCENE_ORDER_FIELD]: order.join(","), [sceneFieldName(3, "narration")]: narration, [sceneFieldName(3, "visualDirection")]: "Plan A\nPlan B" }),
    );
    expect(edited.scenes.map((s) => s.index)).toEqual(order.map((_, i) => i + 1));
    expect(edited.scenes[0]!.narration).toBe(script.scenes[2]!.narration);
    expect(edited.scenes[1]!.narration).toBe(script.scenes[0]!.narration);
    expect(edited.scenes[2]).toMatchObject({ purpose: "development", narration, visualDirection: "Plan A\nPlan B", bRollKeywords: [] });
    expect(edited.factCheckFlags).toEqual([{ sceneIndex: 1, claim: "150 mètres" }]); // la scène 2 est supprimée
    expect(ScriptSchema.safeParse(edited).success).toBe(true);
  });

  it("ignore un ordre illisible et garde celui de la version courante", () => {
    const edited = applyScriptForm(script, form({ [SCENE_ORDER_FIELD]: "1,1,99" }));
    expect(edited.scenes.map((s) => s.narration)).toEqual(script.scenes.map((s) => s.narration));
  });

  it("refuse, par le schéma, une scène ajoutée sans narration", () => {
    const order = [...script.scenes.map((s) => s.index), NEW_SCENE];
    const result = ScriptSchema.safeParse(applyScriptForm(script, form({ [SCENE_ORDER_FIELD]: order.join(",") })));
    expect(result.success).toBe(false);
    const errors = scriptFieldErrors(result.error!.issues.map(({ path, message }) => ({ path, message })));
    expect(errors).toEqual({ [sceneFieldName(order.length, "narration")]: "narration" });
  });
});

describe("scriptFieldErrors", () => {
  it("rattache chaque erreur du schéma à son champ", () => {
    const invalid = applyScriptForm(script, form({ [sceneFieldName(3, "narration")]: "trop court", workingTitle: "x".repeat(101) }));
    const result = ScriptSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    const errors = scriptFieldErrors(result.error!.issues.map(({ path, message }) => ({ path, message })));
    expect(errors).toEqual({
      [sceneFieldName(3, "narration")]: "narration",
      workingTitle: "workingTitle",
    });
  });

  it("ignore les erreurs qui ne correspondent à aucun champ éditable", () => {
    expect(scriptFieldErrors([{ path: ["scenes", 0, "index"], message: "Index attendu : 1" }])).toEqual({});
  });
});
