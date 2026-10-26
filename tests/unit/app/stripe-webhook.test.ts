import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Route du webhook Stripe : signature vérifiée sur le corps brut (signatures générées par le SDK, sans
// réseau), déduplication par stripe_events, transmission à Inngest. Le traitement lui-même est testé
// en base (tests/integration/stripe-sync.test.ts).

const SECRET = "whsec_test_secret";
const env: { STRIPE_WEBHOOK_SECRET?: string } = {};
vi.mock("@/lib/env/server", () => ({ serverEnv: env }));

let insertError: { code: string; message: string } | null;
const inserted: unknown[] = [];
const deleted: string[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: async (row: unknown) => (inserted.push(row), { error: insertError }),
      delete: () => ({ eq: async (_column: string, id: string) => (deleted.push(id), { error: null }) }),
    }),
  }),
}));
const send = vi.fn();
vi.mock("@/lib/jobs/client", () => ({ inngest: { send: (...args: unknown[]) => send(...args) } }));

const { POST } = await import("@/app/api/webhooks/stripe/route");
const signer = new Stripe("sk_test_signature_only").webhooks;

const payload = (type: string, id = "evt_test123") => JSON.stringify({ id, object: "event", type, data: { object: { id: "cs_test123" } } });
const request = (body: string, signature = signer.generateTestHeaderString({ payload: body, secret: SECRET })) =>
  new Request("http://localhost:3000/api/webhooks/stripe", { method: "POST", body, headers: { "stripe-signature": signature } });

beforeEach(() => {
  vi.clearAllMocks();
  env.STRIPE_WEBHOOK_SECRET = SECRET;
  insertError = null;
  inserted.length = 0;
  deleted.length = 0;
  send.mockResolvedValue({ ids: ["evt"] });
});

describe("webhook Stripe", () => {
  it("enregistre l'événement signé puis le transmet à stripe-sync, avec son id comme clé", async () => {
    const response = await POST(request(payload("checkout.session.completed")));
    expect(response.status).toBe(200);
    expect(inserted).toEqual([{ id: "evt_test123", type: "checkout.session.completed", processed_at: null }]);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ name: "stripe/event", data: { id: "evt_test123" }, id: "evt_test123" }));
  });

  it("refuse une signature absente, fausse ou faite avec un autre secret, sans rien enregistrer", async () => {
    const body = payload("invoice.paid");
    for (const signature of ["", "t=1,v1=faux", signer.generateTestHeaderString({ payload: body, secret: "whsec_autre" })]) {
      expect((await POST(request(body, signature))).status).toBe(400);
    }
    // Corps modifié après signature.
    const signed = signer.generateTestHeaderString({ payload: body, secret: SECRET });
    expect((await POST(request(body.replace("invoice.paid", "charge.refunded"), signed))).status).toBe(400);
    expect(inserted).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("répond 200 sans retransmettre un événement déjà reçu", async () => {
    insertError = { code: "23505", message: "duplicate key" };
    const response = await POST(request(payload("invoice.paid")));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Déjà reçu");
    expect(send).not.toHaveBeenCalled();
  });

  it("enregistre comme traité un événement que stripe-sync n'utilise pas", async () => {
    const response = await POST(request(payload("customer.created")));
    expect(response.status).toBe(200);
    expect(inserted).toEqual([{ id: "evt_test123", type: "customer.created", processed_at: expect.any(String) }]);
    expect(send).not.toHaveBeenCalled();
  });

  it("retire l'enregistrement et répond 500 si Inngest est indisponible, pour que Stripe renvoie", async () => {
    send.mockRejectedValue(new Error("Inngest indisponible"));
    expect((await POST(request(payload("invoice.paid")))).status).toBe(500);
    expect(deleted).toEqual(["evt_test123"]);
  });

  it("répond 500 si l'enregistrement échoue, sans transmettre", async () => {
    insertError = { code: "08006", message: "connexion perdue" };
    expect((await POST(request(payload("invoice.paid")))).status).toBe(500);
    expect(send).not.toHaveBeenCalled();
  });

  it("répond 503 tant que le secret du webhook n'est pas configuré", async () => {
    delete env.STRIPE_WEBHOOK_SECRET;
    expect((await POST(request(payload("invoice.paid")))).status).toBe(503);
    expect(inserted).toEqual([]);
  });
});
