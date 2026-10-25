import { serverEnv } from "@/lib/env/server";

export const MODEL_KEYS = ["script.standard", "script.premium", "light", "eval.judge"] as const;
export type ModelKey = (typeof MODEL_KEYS)[number];
export type Effort = "low" | "medium" | "high";

// Arbitrage A1 de docs/PLAN.md. Les niveaux d'effort sont explicites (Opus 5.5 et Haiku 5.5
// valent `medium` par défaut, Sonnet 5.5 `high`) et restent à calibrer par les évaluations.
const DEFAULTS: Record<ModelKey, { id: string; effort: Effort }> = {
  "script.standard": { id: "claude-sonnet-5-5", effort: "medium" },
  "script.premium": { id: "claude-opus-5-5", effort: "high" },
  light: { id: "claude-haiku-5-5", effort: "low" },
  // Juge des évaluations (evals/) : ni Sonnet ni Opus, pour ne favoriser aucune des deux formules
  // comparées (un juge tend à préférer les textes de sa propre famille).
  "eval.judge": { id: "claude-fable-5-1", effort: "medium" },
};

const OVERRIDES: Record<ModelKey, string | undefined> = {
  "script.standard": serverEnv.MODEL_SCRIPT_STANDARD,
  "script.premium": serverEnv.MODEL_SCRIPT_PREMIUM,
  light: serverEnv.MODEL_LIGHT,
  "eval.judge": serverEnv.MODEL_EVAL_JUDGE,
};

// Modèles dont les classifieurs de sécurité peuvent refuser une requête et qui acceptent
// `fallbacks: "default"` sur l'API Claude. Haiku 5.5 n'a pas de repli serveur.
const SERVER_FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export function modelFor(key: ModelKey) {
  const id = OVERRIDES[key] ?? DEFAULTS[key].id;
  return { id, effort: DEFAULTS[key].effort, serverFallback: SERVER_FALLBACK_MODELS.has(id) };
}
