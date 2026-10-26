import { InngestTestEngine } from "@inngest/test";
import { describe, expect, it, vi } from "vitest";
import { createStripeSyncFunction } from "@/lib/jobs/functions/stripe-sync";

// La synchronisation elle-même est testée en base : tests/integration/stripe-sync.test.ts.
describe("fonction Inngest stripe-sync", () => {
  it("synchronise l'événement Stripe reçu par le webhook, dans une étape", async () => {
    const sync = vi.fn().mockResolvedValue({ type: "invoice", action: "renewed", workspaceId: "ws-1" });
    const fn = createStripeSyncFunction({ sync });

    const { result } = await new InngestTestEngine({ function: fn, events: [{ name: "stripe/event", data: { id: "evt_test123" } }] }).execute();

    expect(result).toEqual({ type: "invoice", action: "renewed", workspaceId: "ws-1" });
    expect(sync).toHaveBeenCalledWith("evt_test123");
  });
});
