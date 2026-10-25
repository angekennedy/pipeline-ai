import type Anthropic from "@anthropic-ai/sdk";
import { NonRetriableError } from "inngest";
import type { PipelineStore } from "@/lib/pipeline/store";
import type { PipelineEventPublisher } from "@/lib/realtime/events";

// Dépendances injectées dans les fonctions Inngest (store Supabase en production, mémoire en test).
export type JobDeps = {
  store: () => PipelineStore;
  anthropic?: Anthropic; // injecté par les tests ; sinon le client partagé de lib/ai
  publisher?: (pipelineId: string) => PipelineEventPublisher; // Realtime Broadcast du pipeline
};

// Les erreurs marquées `retryable: false` (refus, schéma invalide après réparation, sortie tronquée,
// dépendance manquante) ne changeraient pas en relançant : Inngest ne les retente pas.
export function toStepError(error: unknown): unknown {
  if (error instanceof Error && (error as { retryable?: unknown }).retryable === false) {
    return new NonRetriableError(error.message, { cause: error });
  }
  return error;
}
