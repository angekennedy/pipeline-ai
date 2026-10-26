import { describe, expect, it } from "vitest";
import { ScriptSchema, type Script } from "@/lib/ai/schemas";
import { SCRIPT_FIELD_MESSAGES, applyScriptForm, sceneFieldName, scriptFieldErrors } from "@/lib/pipeline/script-form";
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

describe("scriptFieldErrors", () => {
  it("rattache chaque erreur du schéma à son champ", () => {
    const invalid = applyScriptForm(script, form({ [sceneFieldName(3, "narration")]: "trop court", workingTitle: "x".repeat(101) }));
    const result = ScriptSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    const errors = scriptFieldErrors(result.error!.issues.map(({ path, message }) => ({ path, message })));
    expect(errors).toEqual({
      [sceneFieldName(3, "narration")]: SCRIPT_FIELD_MESSAGES.narration,
      workingTitle: SCRIPT_FIELD_MESSAGES.workingTitle,
    });
  });

  it("ignore les erreurs qui ne correspondent à aucun champ éditable", () => {
    expect(scriptFieldErrors([{ path: ["scenes", 0, "index"], message: "Index attendu : 1" }])).toEqual({});
  });
});
