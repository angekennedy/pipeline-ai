import "server-only";
import { generateAsset } from "@/lib/pipeline/generate-asset";
import { runPipelineSteps, type StepRunner } from "@/lib/pipeline/run-pipeline";
import type { PipelineStore } from "@/lib/pipeline/store";
import { inngest } from "../client";
import { pipelineCanceled, pipelineRequested } from "../events";
import { toStepError, type JobDeps } from "../step-errors";

// Appelé quand la fonction échoue après ses retries (erreur hors des étapes d'assets).
export const markPipelineFailed =
  (store: () => PipelineStore) =>
  async ({ event }: { event: { data: { event: { data: { pipelineId: string } } } } }) => {
    // Statut `failed` : le store libère le reliquat de la réservation (les assets réussis restent capturés).
    await store().setPipelineStatus(event.data.event.data.pipelineId, "failed");
  };

export function createRunPipelineFunction({ store, openai, publisher }: JobDeps) {
  return inngest.createFunction(
    {
      id: "run-pipeline",
      triggers: [pipelineRequested],
      idempotency: "event.data.pipelineId", // un double envoi ne lance qu'une exécution
      concurrency: [{ key: "event.data.workspaceId", limit: 2 }, { limit: 5 }], // équité, puis plafond global (limite du plan Inngest)
      retries: 3,
      cancelOn: [{ event: pipelineCanceled.name, match: "data.pipelineId" }],
      onFailure: markPipelineFailed(store),
    },
    async ({ event, step }) => {
      const { pipelineId } = event.data;
      // Les étapes renvoient des ids ou rien : valeurs JSON, que la sérialisation d'Inngest conserve.
      const steps: StepRunner = { run: (id, fn) => step.run(id, fn) as never };
      const publish = publisher?.(pipelineId);
      return runPipelineSteps(pipelineId, {
        step: steps,
        store: store(),
        publish,
        generate: (type) =>
          generateAsset(pipelineId, type, { store: store(), client: openai, publish }).catch((error: unknown) => {
            throw toStepError(error);
          }),
      });
    },
  );
}
