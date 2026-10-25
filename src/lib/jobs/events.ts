import { eventType } from "inngest";
import { z } from "zod";

// Envoyé par la Server Action createPipeline, après la réservation des crédits.
export const pipelineRequested = eventType("pipeline/requested", {
  schema: z.object({ pipelineId: z.uuid(), workspaceId: z.uuid() }),
});

// Envoyé quand l'utilisateur annule : arrête l'exécution en cours (cancelOn).
export const pipelineCanceled = eventType("pipeline/canceled", {
  schema: z.object({ pipelineId: z.uuid() }),
});
