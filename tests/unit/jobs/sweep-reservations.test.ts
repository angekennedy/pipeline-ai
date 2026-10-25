import { InngestTestEngine } from "@inngest/test";
import { describe, expect, it, vi } from "vitest";
import { createSweepReservationsFunction } from "@/lib/jobs/functions/sweep-reservations";

// Le balayage lui-même (sélection, libération) est testé en base : tests/integration/billing-flow.test.ts.
describe("fonction Inngest sweep-reservations", () => {
  it("balaie les réservations orphelines toutes les 15 min dans une étape", async () => {
    const sweep = vi.fn().mockResolvedValue(3);
    const fn = createSweepReservationsFunction({ sweep });

    const { result } = await new InngestTestEngine({ function: fn, events: [{ name: "inngest/scheduled.timer", data: { cron: "*/15 * * * *" } }] }).execute();

    expect(result).toEqual({ swept: 3 });
    expect(sweep).toHaveBeenCalledOnce();
    expect(fn.opts.triggers).toEqual([{ cron: "*/15 * * * *" }]);
  });
});
