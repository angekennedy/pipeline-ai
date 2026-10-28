import type { AssetType } from "@/lib/ai/schemas";
import { safePublish } from "@/lib/realtime/broadcast";
import type { PipelineEventPublisher } from "@/lib/realtime/events";
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

const reasonOf = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

// Exécute le DAG : les assets d'une étape partent en parallèle, un asset dont une dépendance n'a pas
// réussi est sauté. Un échec du script laisse donc tous les dérivés de côté. Chaque étape renvoie un
// id de version, petit : le contenu reste en base (limite de taille de l'état des étapes). La vidéo
// n'en fait pas partie : l'utilisateur la lance après avoir relu le script (lib/jobs/request-video).
export async function runPipelineSteps(
  pipelineId: string,
  {
    step,
    store,
    generate,
    publish,
  }: {
    step: StepRunner;
    store: PipelineStore;
    generate: (type: AssetType) => Promise<string>;
    publish?: PipelineEventPublisher;
  },
): Promise<PipelineOutcome> {
  // Publication dans les étapes : une étape mémoïsée n'est pas rejouée, l'événement non plus.
  await step.run("mark-running", async () => {
    await store.setPipelineStatus(pipelineId, "running");
    await safePublish(publish, { type: "pipeline.status", status: "running" });
  });

  const assets = {} as Record<AssetType, AssetOutcome>;
  for (const stage of PIPELINE_STAGES) {
    const runnable = stage.filter((type) => registry[type].dependsOn.every((dep) => assets[dep]?.status === "succeeded"));
    stage.filter((type) => !runnable.includes(type)).forEach((type) => (assets[type] = { status: "skipped" }));

    const results = await Promise.allSettled(runnable.map((type) => step.run(type, () => generate(type))));
    results.forEach((result, i) => {
      assets[runnable[i]!] =
        result.status === "fulfilled"
          ? { status: "succeeded", versionId: result.value }
          : { status: "failed", error: reasonOf(result.reason) };
    });
  }

  const status = finalStatus(assets);
  // Statut terminal : le store libère les crédits non capturés (assets échoués ou sautés). Chaque
  // asset réussi a déjà capturé son coût, dans la transaction de sa version.
  await step.run("finalize", async () => {
    await store.setPipelineStatus(pipelineId, status);
    await safePublish(publish, { type: "pipeline.status", status });
  });
  return { status, assets };
}
