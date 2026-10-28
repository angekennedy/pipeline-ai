import type { Scene, Script } from "@/lib/ai/schemas";
import type { SchemaIssue } from "@/lib/ai/structured";

// Éditeur du script (tâche 4.2) : champs de texte éditables, appliqués sur la version courante. Le
// reste (rôle des scènes, mots-clés B-roll, points à vérifier) est conservé ; la durée des scènes est
// recalculée par le post-traitement du registre (applyTiming), comme pour une sortie du modèle.
// Les scènes peuvent être ajoutées, supprimées ou déplacées : `sceneOrder` donne, position par
// position, la scène d'origine (son index) ou `new`. Les champs portent la nouvelle position.

export const SCENE_FIELDS = ["title", "narration", "visualDirection", "onScreenText"] as const;
export type SceneField = (typeof SCENE_FIELDS)[number];
export const SCRIPT_FIELDS = ["workingTitle", "hookSummary", "callToAction"] as const;

export const sceneFieldName = (index: number, field: SceneField) => `scene-${index}-${field}`;
export const SCENE_ORDER_FIELD = "sceneOrder";
export const NEW_SCENE = "new";

// Ordre des scènes envoyé par l'éditeur ; absent ou illisible, l'ordre de la version courante.
function sceneOrder(current: Script, data: FormData): Array<number | typeof NEW_SCENE> {
  const value = data.get(SCENE_ORDER_FIELD);
  const fallback = current.scenes.map((scene) => scene.index);
  if (typeof value !== "string" || !value.trim()) return fallback;
  const order = value.split(",").map((token) => (token.trim() === NEW_SCENE ? NEW_SCENE : Number(token)));
  const known = order.every((source) => source === NEW_SCENE || (Number.isInteger(source) && source >= 1 && source <= current.scenes.length));
  const unique = new Set(order.filter((source) => source !== NEW_SCENE)).size === order.filter((source) => source !== NEW_SCENE).length;
  return known && unique ? order : fallback;
}

// Scène ajoutée : rôle `development`, sans mots-clés ; narration à écrire (au moins 20 caractères).
const blankScene = (): Scene => ({
  index: 0,
  purpose: "development",
  title: "",
  narration: "",
  visualDirection: "",
  bRollKeywords: [],
  onScreenText: null,
  estimatedSeconds: 1,
});

// Champ du formulaire → champ du script en erreur, dont l'éditeur affiche le message (ScriptEditor.errors).
export type ScriptErrorField = (typeof SCRIPT_FIELDS)[number] | SceneField;

// Retours à la ligne normalisés : un texte retapé dans le navigateur arrive en CRLF.
const text = (data: FormData, name: string, fallback: string) => {
  const value = data.get(name);
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : fallback;
};

export function applyScriptForm(current: Script, data: FormData): Script {
  const order = sceneOrder(current, data);
  // Index d'origine → nouvelle position, pour les points à vérifier ; ceux d'une scène supprimée tombent.
  const moved = new Map(order.flatMap((source, i) => (source === NEW_SCENE ? [] : [[source, i + 1] as const])));
  return {
    ...current,
    workingTitle: text(data, "workingTitle", current.workingTitle),
    hookSummary: text(data, "hookSummary", current.hookSummary),
    callToAction: text(data, "callToAction", current.callToAction),
    scenes: order.map((source, i) => {
      const scene = source === NEW_SCENE ? blankScene() : current.scenes[source - 1]!;
      const index = i + 1;
      const onScreen = text(data, sceneFieldName(index, "onScreenText"), scene.onScreenText ?? "");
      return {
        ...scene,
        index,
        title: text(data, sceneFieldName(index, "title"), scene.title),
        narration: text(data, sceneFieldName(index, "narration"), scene.narration),
        visualDirection: text(data, sceneFieldName(index, "visualDirection"), scene.visualDirection),
        onScreenText: onScreen || null,
      };
    }),
    factCheckFlags: current.factCheckFlags.flatMap((flag) => {
      const index = moved.get(flag.sceneIndex);
      return index ? [{ ...flag, sceneIndex: index }] : [];
    }),
  };
}

// Erreurs de validation (editAsset) → champ du formulaire et champ du script concerné.
export function scriptFieldErrors(issues: SchemaIssue[]): Record<string, ScriptErrorField> {
  const errors: Record<string, ScriptErrorField> = {};
  for (const { path } of issues) {
    const [head, i, field] = path;
    if (head === "scenes" && typeof i === "number" && SCENE_FIELDS.includes(field as SceneField)) {
      errors[sceneFieldName(i + 1, field as SceneField)] = field as SceneField;
    } else if (SCRIPT_FIELDS.includes(head as (typeof SCRIPT_FIELDS)[number])) {
      errors[head as string] = head as (typeof SCRIPT_FIELDS)[number];
    }
  }
  return errors;
}
