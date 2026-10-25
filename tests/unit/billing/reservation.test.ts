import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Brief, ChannelPreset } from "@/lib/ai/schemas";
import { InsufficientCreditsError, createPipelineWithReservation, sweepStaleReservations } from "@/lib/billing/reservation";
import type { Database } from "@/lib/supabase/database.types";
import { validBrief, validChannel } from "../../fixtures/assets";

// Le comportement en base (concurrence, idempotence, droits) est couvert par
// tests/integration/credits.test.ts ; ici, la traduction des réponses de la RPC.
function fakeDb(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(response);
  return { db: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

const input = {
  workspaceId: "ws-1",
  userId: "user-1",
  brief: { ...validBrief, durationMinutes: 10 } as Brief,
  tier: "standard" as const,
  idempotencyKey: "form-1",
};

describe("createPipelineWithReservation", () => {
  it("réserve le coût total du pipeline et renvoie le pipeline créé", async () => {
    const { db, rpc } = fakeDb({ data: [{ pipeline_id: "pipe-1", created: true }], error: null });
    const channel = { id: "ch-1", snapshot: validChannel as ChannelPreset };

    await expect(createPipelineWithReservation(db, { ...input, channel })).resolves.toEqual({ pipelineId: "pipe-1", created: true, credits: 21 });
    expect(rpc).toHaveBeenCalledWith("create_pipeline_with_reservation", {
      p_workspace: "ws-1",
      p_user: "user-1",
      p_brief: input.brief,
      p_tier: "standard",
      p_credits: 21,
      p_key: "form-1",
      p_channel: "ch-1",
      p_channel_snapshot: validChannel,
    });
  });

  it("traduit un solde insuffisant en erreur typée avec les deux montants", async () => {
    const { db } = fakeDb({
      data: null,
      error: { message: "INSUFFICIENT_CREDITS", code: "P0001", details: '{"required" : 21, "available" : 5}' },
    });
    const error = await createPipelineWithReservation(db, input).catch((e) => e);
    expect(error).toBeInstanceOf(InsufficientCreditsError);
    expect(error).toMatchObject({ code: "INSUFFICIENT_CREDITS", required: 21, available: 5 });
  });

  it("laisse remonter les autres erreurs avec leur code", async () => {
    const { db } = fakeDb({ data: null, error: { message: "FORBIDDEN", code: "42501", details: "" } });
    await expect(createPipelineWithReservation(db, input)).rejects.toMatchObject({ message: "Création du pipeline : FORBIDDEN", code: "42501" });
  });

  it("échoue si la RPC ne renvoie aucune ligne", async () => {
    const { db } = fakeDb({ data: [], error: null });
    await expect(createPipelineWithReservation(db, input)).rejects.toThrow("aucune ligne");
  });
});

describe("sweepStaleReservations", () => {
  it("renvoie le nombre de pipelines balayés", async () => {
    const { db, rpc } = fakeDb({ data: 2, error: null });
    await expect(sweepStaleReservations(db)).resolves.toBe(2);
    expect(rpc).toHaveBeenCalledWith("sweep_stale_reservations");
  });

  it("laisse remonter une erreur de la RPC", async () => {
    const { db } = fakeDb({ data: null, error: { message: "boom", code: "XX000" } });
    await expect(sweepStaleReservations(db)).rejects.toMatchObject({ message: "Balayage des réservations : boom", code: "XX000" });
  });
});
