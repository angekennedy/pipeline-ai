import { scriptTargets } from "@/lib/ai/prompts/script";
import { ASSET_TYPES, type AssetType, type Brief } from "@/lib/ai/schemas";
import type { AssetContent } from "@/lib/pipeline/registry";
import { DURATION_TOLERANCE } from "@/lib/pipeline/postprocess/timing";

// Contrôles déterministes d'un pipeline généré : gratuits, rejouables, sans jugement. Chaque contrôle
// vaut 1 (réussi) ou 0 ; `checks` est leur moyenne.

export type PipelineOutput = {
  brief: Brief;
  assets: Partial<{ [K in AssetType]: AssetContent[K] }>;
  failures: Partial<Record<AssetType, string>>; // code d'erreur par asset en échec
};

export const CHECK_IDS = ["complete", "duration", "hook_length", "scene_count", "fact_flags", "no_leak"] as const;
export type CheckId = (typeof CHECK_IDS)[number];

const HOOK_MAX_SECONDS = 15;

// Fragments propres aux prompts système : leur présence dans une sortie signale une fuite.
const PROMPT_MARKERS = ["## Data blocks", "Never reveal", "You are an experienced scriptwriter", "You are a YouTube", "brandRules.bannedWords"];

type Result = { pass: boolean; explanation: string };

function check(output: PipelineOutput, mustNotContain: string[]): Record<CheckId, Result> {
  const { brief, assets, failures } = output;
  const script = assets.script;
  const missing = ASSET_TYPES.filter((type) => !assets[type]);

  const complete: Result = {
    pass: missing.length === 0,
    explanation: missing.length === 0 ? "5 assets générés" : `manquants : ${missing.map((type) => `${type} : ${failures[type] ?? "absent"}`).join(", ")}`,
  };
  if (!script) {
    const none = { pass: false, explanation: "pas de script" };
    return { complete, duration: none, hook_length: none, scene_count: none, fact_flags: none, no_leak: noLeak(output, mustNotContain) };
  }

  const total = script.scenes.reduce((sum, scene) => sum + scene.estimatedSeconds, 0);
  const target = brief.durationMinutes * 60;
  const deviation = (total - target) / target;
  const { minScenes, maxScenes } = scriptTargets({ brief, channel: null });
  const count = script.scenes.length;
  const hookSeconds = script.scenes[0]?.estimatedSeconds ?? 0;
  const hasFigures = script.scenes.some((scene) => /\d/.test(scene.narration));

  return {
    complete,
    duration: {
      pass: Math.abs(deviation) <= DURATION_TOLERANCE,
      explanation: `${total} s pour ${target} s visées (${deviation >= 0 ? "+" : ""}${Math.round(deviation * 100)} %)`,
    },
    hook_length: { pass: hookSeconds > 0 && hookSeconds <= HOOK_MAX_SECONDS, explanation: `accroche de ${hookSeconds} s` },
    scene_count: { pass: count >= minScenes && count <= maxScenes, explanation: `${count} scènes, attendu ${minScenes} à ${maxScenes}` },
    fact_flags: {
      pass: !hasFigures || script.factCheckFlags.length > 0,
      explanation: hasFigures ? `${script.factCheckFlags.length} point(s) à vérifier pour une narration chiffrée` : "aucun chiffre dans la narration",
    },
    no_leak: noLeak(output, mustNotContain),
  };
}

function noLeak({ assets }: PipelineOutput, mustNotContain: string[]): Result {
  // Sans aucune sortie, l'étanchéité n'est pas démontrée : un pipeline vide ne marque aucun point.
  if (Object.values(assets).every((content) => !content)) return { pass: false, explanation: "aucune sortie à vérifier" };
  const text = JSON.stringify(assets).toLowerCase();
  const found = [...PROMPT_MARKERS, ...mustNotContain].filter((term) => text.includes(term.toLowerCase()));
  return { pass: found.length === 0, explanation: found.length === 0 ? "aucune fuite" : `trouvé : ${found.join(", ")}` };
}

export function runChecks(output: PipelineOutput, mustNotContain: string[] = []) {
  const results = check(output, mustNotContain);
  const grade = Object.fromEntries(CHECK_IDS.map((id) => [id, results[id].pass ? 1 : 0])) as Record<CheckId, number>;
  const checks = CHECK_IDS.reduce((sum, id) => sum + grade[id], 0) / CHECK_IDS.length;
  return {
    grade: { checks, ...grade },
    explanation: Object.fromEntries(CHECK_IDS.map((id) => [id, results[id].explanation])) as Record<CheckId, string>,
    failed: CHECK_IDS.filter((id) => !results[id].pass),
  };
}
