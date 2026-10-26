import "server-only";
import { inngest } from "../client";

// Filet de sécurité des réservations de crédits (ARCHITECTURE §5.2) : toutes les 15 min, les
// pipelines restés `queued` ou `running` sans activité depuis 30 min passent en échec et libèrent
// leur réservation. Couvre une exécution perdue ou un onFailure qui n'a pas abouti. Purge aussi les
// horodatages des rate limits inactifs (migration 0013).
export function createSweepReservationsFunction({ sweep, purgeRateLimits }: { sweep: () => Promise<number>; purgeRateLimits: () => Promise<number> }) {
  return inngest.createFunction(
    {
      id: "sweep-reservations",
      triggers: [{ cron: "*/15 * * * *" }],
      concurrency: [{ limit: 1 }], // un balayage à la fois
    },
    async ({ step }) => {
      const swept = await step.run("sweep", () => sweep());
      const purged = await step.run("purge-rate-limits", () => purgeRateLimits());
      return { swept, purged };
    },
  );
}
