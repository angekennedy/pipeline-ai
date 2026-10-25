import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { NonRetriableError } from "inngest";
import { generateAsset } from "@/lib/pipeline/generate-asset";
import { runPipelineSteps, type StepRunner } from "@/lib/pipeline/run-pipeline";
import type { PipelineStore } from "@/lib/pipeline/store";
import type { PipelineEventPublisher } from "@/lib/realtime/events";
import { inngest } from "../client";
import { pipelineCanceled, pipelineRequested } from "../events";

type Deps = {
  store: () => PipelineStore;
  anthropic?: Anthropic; // injecté par les tests ; sinon le client partagé de lib/ai
  publisher?: (pipelineId: string) => PipelineEventPublisher; // Realtime Broadcast du pipeline
};

// Les erreurs marquées `retryable: false` (refus, schéma invalide après réparation, sortie tronquée,
// dépendance manquante) ne changeraient pas en relançant : Inngest ne les retente pas.
function toStepError(error: unknown): unknown {
  if (error instanceof Error && (error as { retryable?: unknown }).retryable === false) {
    return new NonRetriableError(error.message, { cause: error });
  }
  return error;
}

// Appelé quand la fonction échoue après ses retries (erreur hors des étapes d'assets).
export const markPipelineFailed =
  (store: () => PipelineStore) =>
  async ({ event }: { event: { data: { event: { data: { pipelineId: string } } } } }) => {
    // Phase 3 : libérer toute la réservation de crédits.
    await store().setPipelineStatus(event.data.event.data.pipelineId, "failed");
  };

export function createRunPipelineFunction({ store, anthropic, publisher }: Deps) {
  return inngest.createFunction(
    {
      id: "run-pipeline",
      triggers: [pipelineRequested],
      idempotency: "event.data.pipelineId", // un double envoi ne lance qu'une exécution
      concurrency: [{ key: "event.data.workspaceId", limit: 2 }, { limit: 50 }], // équité, puis plafond global
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
          generateAsset(pipelineId, type, { store: store(), client: anthropic, publish }).catch((error: unknown) => {
            throw toStepError(error);
          }),
      });
    },
  );
}
