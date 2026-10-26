import "server-only";
import type { Alert } from "@/lib/admin/economics";
import { inngest } from "../client";

// Alertes de la tâche 4.6, toutes les 15 min : pipeline à plus de 3× le coût médian de sa formule,
// taux d'échec des générations au-delà de 5 %, réservations que le balayage n'a pas libérées.
export function createMonitorEconomicsFunction({ check, report }: { check: () => Promise<Alert[]>; report: (alerts: Alert[]) => void }) {
  return inngest.createFunction(
    {
      id: "monitor-economics",
      triggers: [{ cron: "*/15 * * * *" }],
      concurrency: [{ limit: 1 }],
    },
    async ({ step }) => {
      const alerts = await step.run("check", () => check());
      if (alerts.length > 0) await step.run("report", () => report(alerts));
      return { alerts: alerts.map((alert) => alert.kind) };
    },
  );
}
