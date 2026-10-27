import type { OpenAIClient } from "@/lib/ai/openai";
import { NonRetriableError } from "inngest";
import type { ImageDeps } from "@/lib/media/thumbnail-images";
import type { PipelineStore } from "@/lib/pipeline/store";
import type { VideoDeps } from "@/lib/video/run-video";
import type { PipelineEventPublisher } from "@/lib/realtime/events";

// Dépendances injectées dans les fonctions Inngest (store Supabase en production, mémoire en test).
export type JobDeps = {
  store: () => PipelineStore;
  openai?: OpenAIClient; // injecté par les tests ; sinon le client partagé de lib/ai
  publisher?: (pipelineId: string) => PipelineEventPublisher; // Realtime Broadcast du pipeline
  // Libère les crédits réservés d'une régénération en échec définitif (migration 0012).
  releaseRegeneration?: (key: string) => Promise<number>;
  // Images des miniatures ; absentes (tests, évaluations), les concepts restent sans image.
  images?: () => ImageDeps;
  // Vidéo MP4 ; null quand la voix ou le rendu ne sont pas configurés (media/config).
  video?: () => VideoDeps | null;
};

// Les erreurs marquées `retryable: false` (refus, schéma invalide après réparation, sortie tronquée,
// dépendance manquante) ne changeraient pas en relançant : Inngest ne les retente pas.
export function toStepError(error: unknown): unknown {
  if (error instanceof Error && (error as { retryable?: unknown }).retryable === false) {
    return new NonRetriableError(error.message, { cause: error });
  }
  return error;
}
