import type { Script } from "@/lib/ai/schemas";
import type { SchemaIssue } from "@/lib/ai/structured";

// Éditeur du script (tâche 4.2) : champs de texte éditables, appliqués sur la version courante. Le
// reste (rôle des scènes, mots-clés B-roll, points à vérifier) est conservé ; la durée des scènes est
// recalculée par le post-traitement du registre (applyTiming), comme pour une sortie du modèle.

export const SCENE_FIELDS = ["title", "narration", "visualDirection", "onScreenText"] as const;
export type SceneField = (typeof SCENE_FIELDS)[number];
export const SCRIPT_FIELDS = ["workingTitle", "hookSummary", "callToAction"] as const;

export const sceneFieldName = (index: number, field: SceneField) => `scene-${index}-${field}`;

export const SCRIPT_FIELD_MESSAGES: Record<(typeof SCRIPT_FIELDS)[number] | SceneField, string> = {
  workingTitle: "Le titre de travail tient en 100 caractères au plus.",
  hookSummary: "Le résumé de l'accroche tient en 300 caractères au plus.",
  callToAction: "L'appel à l'action tient en 300 caractères au plus.",
  title: "Le titre de la scène tient en 80 caractères au plus.",
  narration: "La narration fait au moins 20 caractères.",
  visualDirection: "La direction visuelle tient en 400 caractères au plus.",
  onScreenText: "Le texte à l'écran tient en 60 caractères au plus.",
};

// Retours à la ligne normalisés : un texte retapé dans le navigateur arrive en CRLF.
const text = (data: FormData, name: string, fallback: string) => {
  const value = data.get(name);
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : fallback;
};

export function applyScriptForm(current: Script, data: FormData): Script {
  return {
    ...current,
    workingTitle: text(data, "workingTitle", current.workingTitle),
    hookSummary: text(data, "hookSummary", current.hookSummary),
    callToAction: text(data, "callToAction", current.callToAction),
    scenes: current.scenes.map((scene) => {
      const onScreen = text(data, sceneFieldName(scene.index, "onScreenText"), scene.onScreenText ?? "");
      return {
        ...scene,
        title: text(data, sceneFieldName(scene.index, "title"), scene.title),
        narration: text(data, sceneFieldName(scene.index, "narration"), scene.narration),
        visualDirection: text(data, sceneFieldName(scene.index, "visualDirection"), scene.visualDirection),
        onScreenText: onScreen || null,
      };
    }),
  };
}

// Erreurs de validation (editAsset) → champ du formulaire et message lisible.
export function scriptFieldErrors(issues: SchemaIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const { path } of issues) {
    const [head, i, field] = path;
    if (head === "scenes" && typeof i === "number" && SCENE_FIELDS.includes(field as SceneField)) {
      errors[sceneFieldName(i + 1, field as SceneField)] = SCRIPT_FIELD_MESSAGES[field as SceneField];
    } else if (SCRIPT_FIELDS.includes(head as (typeof SCRIPT_FIELDS)[number])) {
      errors[head as string] = SCRIPT_FIELD_MESSAGES[head as (typeof SCRIPT_FIELDS)[number]];
    }
  }
  return errors;
}
