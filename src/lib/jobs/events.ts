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

const RegenerationKey = z.string().regex(/^regen:[\w-]{8,64}$/); // `regen:<nonce>`, une par asset et par demande

// Envoyé par la Server Action de régénération, après la réservation des crédits de chaque asset avec
// sa clé. `then` : assets régénérés ensuite, dans l'ordre (dérivés qui dépendent du premier).
export const assetRegenerateRequested = eventType("asset/regenerate.requested", {
  schema: z.object({
    pipelineId: z.uuid(),
    workspaceId: z.uuid(),
    assetType: z.enum(ASSET_TYPES),
    regenerationKey: RegenerationKey,
    feedback: z.string().trim().min(1).max(1000).optional(), // consigne libre, non fiable, pour le premier asset
    then: z.array(z.object({ assetType: z.enum(ASSET_TYPES), regenerationKey: RegenerationKey })).max(4).optional(),
  }),
});

// Envoyé par le webhook Stripe, une fois l'événement enregistré dans stripe_events. Seul l'id voyage :
// la fonction stripe-sync relit l'événement chez Stripe.
export const stripeEventReceived = eventType("stripe/event", {
  schema: z.object({ id: z.string().regex(/^evt_\w+$/) }),
});
