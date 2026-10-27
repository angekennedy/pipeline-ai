import { serverEnv } from "@/lib/env/server";

export const MODEL_KEYS = ["script.standard", "script.premium", "light", "eval.judge"] as const;
export type ModelKey = (typeof MODEL_KEYS)[number];

// Modèles OpenAI par rôle. Le script, cœur du livrable, passe par gpt-4o ; les quatre dérivés et la
// modération par gpt-4o-mini, dont le tarif garde la grille de crédits tenable. Premium utilise le
// même modèle par défaut : MODEL_SCRIPT_PREMIUM permet d'en choisir un autre sans changer le code.
const DEFAULTS: Record<ModelKey, string> = {
  "script.standard": "gpt-4o",
  "script.premium": "gpt-4o",
  light: "gpt-4o-mini",
  // Juge des évaluations (evals/) : même famille que les modèles évalués, à surcharger par
  // MODEL_EVAL_JUDGE pour un juge neutre.
  "eval.judge": "gpt-4o",
};

const OVERRIDES: Record<ModelKey, string | undefined> = {
  "script.standard": serverEnv.MODEL_SCRIPT_STANDARD,
  "script.premium": serverEnv.MODEL_SCRIPT_PREMIUM,
  light: serverEnv.MODEL_LIGHT,
  "eval.judge": serverEnv.MODEL_EVAL_JUDGE,
};

export function modelFor(key: ModelKey) {
  return { id: OVERRIDES[key] ?? DEFAULTS[key] };
}

// Images (miniatures, plans de la vidéo). gpt-image-1 a été retiré le 23 octobre 2026.
export const imageModel = () => serverEnv.MODEL_IMAGE ?? "gpt-image-2";
