import "server-only";
import type { SyncResult } from "@/lib/billing/stripe-sync";
import { inngest } from "../client";
import { stripeEventReceived } from "../events";

// Traitement durable des webhooks Stripe (ARCHITECTURE §5.3) : relancé par Inngest en cas d'erreur.
// L'id de l'événement Inngest est celui de l'événement Stripe : un envoi en double n'est exécuté
// qu'une fois. Rejouer le traitement est sans effet (écritures idempotentes, migration 0011).
export function createStripeSyncFunction({ sync }: { sync: (eventId: string) => Promise<SyncResult> }) {
  return inngest.createFunction(
    {
      id: "stripe-sync",
      triggers: [stripeEventReceived],
      concurrency: [{ limit: 5 }],
      retries: 8,
    },
    async ({ event, step }) => step.run("sync", () => sync(event.data.id)),
  );
}
