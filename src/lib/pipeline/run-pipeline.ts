import type { AssetType } from "@/lib/ai/schemas";
import { PIPELINE_STAGES } from "./dag";
import { registry } from "./registry";
import type { PipelineStatus, PipelineStore } from "./store";

// Sous-ensemble de `step` d'Inngest : une étape mémoïsée, relancée selon la politique de retries,
// qui rejette une fois les retries épuisés. lib/pipeline ne dépend pas d'Inngest (ADR-001).
export type StepRunner = {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
};

export type AssetOutcome =
  | { status: "succeeded"; versionId: string }
  | { status: "failed"; error: string }
  | { status: "skipped" }; // une dépendance a échoué ou a été sautée

export type PipelineOutcome = {
  status: Extract<PipelineStatus, "completed" | "partial" | "failed">;
  assets: Record<AssetType, AssetOutcome>;
};

function finalStatus(assets: Record<AssetType, AssetOutcome>): PipelineOutcome["status"] {
  if (assets.script.status !== "succeeded") return "failed";
  return Object.values(assets).every((asset) => asset.status === "succeeded") ? "completed" : "partial";
}

// Exécute le DAG : les assets d'une étape partent en parallèle, un asset dont une dépendance n'a pas
// réussi est sauté. Un échec du script laisse donc tous les dérivés de côté. Chaque étape renvoie un
// id de version, petit : le contenu reste en base (limite de taille de l'état des étapes).
export async function runPipelineSteps(
  pipelineId: string,
  { step, store, generate }: { step: StepRunner; store: PipelineStore; generate: (type: AssetType) => Promise<string> },
): Promise<PipelineOutcome> {
  await step.run("mark-running", () => store.setPipelineStatus(pipelineId, "running"));

  const assets = {} as Record<AssetType, AssetOutcome>;
  for (const stage of PIPELINE_STAGES) {
    const runnable = stage.filter((type) => registry[type].dependsOn.every((dep) => assets[dep]?.status === "succeeded"));
    stage.filter((type) => !runnable.includes(type)).forEach((type) => (assets[type] = { status: "skipped" }));

    const results = await Promise.allSettled(runnable.map((type) => step.run(type, () => generate(type))));
    results.forEach((result, i) => {
      assets[runnable[i]!] =
        result.status === "fulfilled"
          ? { status: "succeeded", versionId: result.value }
          : { status: "failed", error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
    });
  }

  const status = finalStatus(assets);
  // Phase 3 : capture des crédits consommés et libération de ceux des assets échoués ou sautés.
  await step.run("finalize", () => store.setPipelineStatus(pipelineId, status));
  return { status, assets };
}
