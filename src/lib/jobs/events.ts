import { eventType } from "inngest";
import { z } from "zod";
import { ASSET_TYPES } from "@/lib/ai/schemas";

// Envoyé par la Server Action createPipeline, après la réservation des crédits.
export const pipelineRequested = eventType("pipeline/requested", {
  schema: z.object({ pipelineId: z.uuid(), workspaceId: z.uuid() }),
});

// Envoyé quand l'utilisateur annule : arrête l'exécution en cours (cancelOn).
export const pipelineCanceled = eventType("pipeline/canceled", {
  schema: z.object({ pipelineId: z.uuid() }),
});

// Envoyé par la Server Action regenerateAsset, après la réservation des crédits avec la même clé.
export const assetRegenerateRequested = eventType("asset/regenerate.requested", {
  schema: z.object({
    pipelineId: z.uuid(),
    workspaceId: z.uuid(),
    assetType: z.enum(ASSET_TYPES),
    regenerationKey: z.string().regex(/^regen:[\w-]{8,64}$/), // `regen:<nonce>`, une par demande
    feedback: z.string().trim().min(1).max(1000).optional(), // consigne libre, non fiable
  }),
});
