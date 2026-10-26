import { beforeEach, describe, expect, it, vi } from "vitest";
import { validBrief } from "../../fixtures/assets";

// Demande de régénération : contrôles, réservations, envoi et libération. La réservation elle-même et
// la capture sont testées en base (tests/integration/regeneration.test.ts).

let available: number;
vi.mock("@/lib/billing/balance", () => ({ getCreditSummary: async () => ({ planKey: "creator", balance: available, reserved: 0, available }) }));
const reserved: string[] = [];
const released: string[] = [];
let failReservationAt: string | null;
vi.mock("@/lib/billing/reservation", async (original) => ({
  ...(await original<typeof import("@/lib/billing/reservation")>()),
  reserveRegeneration: async (_db: unknown, input: { key: string }) => {
    if (input.key === failReservationAt) throw new Error("PLAN_RESTRICTED");
    reserved.push(input.key);
    return true;
  },
  releaseRegeneration: async (_db: unknown, key: string) => (released.push(key), 1),
}));
const send = vi.fn();
vi.mock("@/lib/jobs/client", () => ({ inngest: { send: (...args: unknown[]) => send(...args) } }));

const { PipelineBusyError, requestRegeneration } = await import("@/lib/jobs/request-regeneration");
const { InsufficientCreditsError } = await import("@/lib/billing/reservation");

let status: string;
const admin = {
  from: () => {
    const builder = { select: () => builder, eq: () => builder, single: async () => ({ data: { brief: validBrief, model_tier: "standard", status }, error: null }) };
    return builder;
  },
} as never;

const NONCE = "8b0b2e2a-6f3e-4e0e-9a51-2a8f4c1d9e70";
const request = (types: Array<"script" | "titles" | "seo" | "voiceover" | "thumbnails">) => ({
  workspaceId: "ws-1",
  userId: "user-1",
  pipelineId: "4d1f7c3e-2b6a-4f8e-9c0d-1a2b3c4d5e6f",
  types,
  nonce: NONCE,
});

beforeEach(() => {
  vi.clearAllMocks();
  available = 100;
  status = "completed";
  failReservationAt = null;
  reserved.length = 0;
  released.length = 0;
  send.mockResolvedValue({ ids: ["evt"] });
});

describe("requestRegeneration", () => {
  it("réserve chaque asset dans l'ordre du DAG, puis envoie une seule exécution qui les enchaîne", async () => {
    // Demandés dans le désordre : remis dans l'ordre du DAG.
    expect(await requestRegeneration(admin, request(["thumbnails", "seo", "titles"]))).toEqual({ credits: 1 + 2 + 1 });
    expect(reserved).toEqual([`regen:${NONCE}-titles`, `regen:${NONCE}-seo`, `regen:${NONCE}-thumbnails`]);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0]).toMatchObject({
      name: "asset/regenerate.requested",
      id: `regen:${NONCE}-titles`,
      data: {
        assetType: "titles",
        regenerationKey: `regen:${NONCE}-titles`,
        then: [
          { assetType: "seo", regenerationKey: `regen:${NONCE}-seo` },
          { assetType: "thumbnails", regenerationKey: `regen:${NONCE}-thumbnails` },
        ],
      },
    });
    expect(released).toEqual([]);
  });

  it("n'envoie pas de liste `then` pour un seul asset", async () => {
    await requestRegeneration(admin, request(["voiceover"]));
    expect(send.mock.calls[0]![0].data).not.toHaveProperty("then");
  });

  it("refuse un pipeline encore en cours, sans rien réserver", async () => {
    status = "running";
    await expect(requestRegeneration(admin, request(["titles"]))).rejects.toBeInstanceOf(PipelineBusyError);
    expect(reserved).toEqual([]);
  });

  it("refuse un solde insuffisant pour l'ensemble, sans rien réserver", async () => {
    available = 3; // titres 1 + SEO 2 + voix off 2 = 5
    const error = await requestRegeneration(admin, request(["titles", "seo", "voiceover"])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InsufficientCreditsError);
    expect(error).toMatchObject({ required: 5, available: 3 });
    expect(reserved).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("libère les réservations faites si une réservation suivante ou l'envoi échoue", async () => {
    failReservationAt = `regen:${NONCE}-seo`;
    await expect(requestRegeneration(admin, request(["titles", "seo"]))).rejects.toThrow("PLAN_RESTRICTED");
    expect(released).toEqual([`regen:${NONCE}-titles`]);

    failReservationAt = null;
    released.length = 0;
    reserved.length = 0;
    send.mockRejectedValueOnce(new Error("Inngest indisponible"));
    await expect(requestRegeneration(admin, request(["titles", "seo"]))).rejects.toThrow("Inngest indisponible");
    expect(released).toEqual([`regen:${NONCE}-titles`, `regen:${NONCE}-seo`]);
  });
});
