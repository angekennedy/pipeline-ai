import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlreadySubscribedError, createCheckoutSession, createPortalSession, stripeCanceler } from "@/lib/billing/stripe";
import { itemForLookupKey } from "@/lib/billing/plans";

// Paramètres envoyés à Stripe, sans réseau : client Stripe et client service role simulés.

const workspace = { id: "ws-1", slug: "mon-espace", name: "Mon espace" };
const origin = "http://localhost:3000";

let customerId: string | null;
let activeSubscriptions: { id: string }[];
const linked: unknown[] = [];
const admin = {
  from: (table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      limit: async () => ({ data: table === "subscriptions" ? activeSubscriptions : [], error: null }),
      single: async () => ({ data: { stripe_customer_id: customerId }, error: null }),
    };
    return builder;
  },
  rpc: async (name: string, args: unknown) => (linked.push({ name, args }), { error: null }),
} as never;

const stripe = {
  prices: { list: vi.fn(async ({ lookup_keys }: { lookup_keys: string[] }) => ({ data: [{ id: `price_${lookup_keys[0]}` }] })) },
  customers: { create: vi.fn(async () => ({ id: "cus_new" })) },
  checkout: { sessions: { create: vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" })) } },
  billingPortal: { sessions: { create: vi.fn(async () => ({ url: "https://billing.stripe.com/p/session/1" })) } },
  subscriptions: { cancel: vi.fn(), retrieve: vi.fn() },
};
const client = stripe as unknown as Stripe;

beforeEach(() => {
  vi.clearAllMocks();
  customerId = null;
  activeSubscriptions = [];
  linked.length = 0;
});

describe("createCheckoutSession", () => {
  it("abonnement : crée le client Stripe du workspace une fois, puis une session avec ses métadonnées", async () => {
    const url = await createCheckoutSession(client, admin, { workspace, email: "ada@test.local", item: itemForLookupKey("plan_creator_monthly")!, origin });
    expect(url).toBe("https://checkout.stripe.com/c/pay/cs_1");
    expect(stripe.customers.create).toHaveBeenCalledWith(
      { name: "Mon espace", email: "ada@test.local", metadata: { workspace_id: "ws-1" } },
      { idempotencyKey: "customer:ws-1" },
    );
    expect(linked).toEqual([{ name: "stripe_link_customer", args: { p_workspace: "ws-1", p_customer: "cus_new" } }]);
    const metadata = { workspace_id: "ws-1", lookup_key: "plan_creator_monthly" };
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith({
      mode: "subscription",
      customer: "cus_new",
      line_items: [{ price: "price_plan_creator_monthly", quantity: 1 }],
      metadata,
      subscription_data: { metadata },
      success_url: "http://localhost:3000/w/mon-espace/billing?success=1",
      cancel_url: "http://localhost:3000/w/mon-espace/billing?canceled=1",
      locale: "fr",
    });
  });

  it("rappelle les CGU sous le bouton de paiement quand un message est fourni", async () => {
    await createCheckoutSession(client, admin, { workspace, email: null, item: itemForLookupKey("pack_200")!, origin, consentMessage: "En payant, vous acceptez les CGU : http://localhost:3000/cgu" });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ custom_text: { submit: { message: "En payant, vous acceptez les CGU : http://localhost:3000/cgu" } } }),
    );
  });

  it("rattache le paiement à la personne qui le lance, pour le funnel", async () => {
    await createCheckoutSession(client, admin, { workspace, email: null, item: itemForLookupKey("pack_200")!, origin, userId: "user-1" });
    const metadata = { workspace_id: "ws-1", lookup_key: "pack_200", user_id: "user-1" };
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ metadata, payment_intent_data: { metadata } }));
  });

  it("pack : paiement unique, client existant réutilisé", async () => {
    customerId = "cus_existing";
    await createCheckoutSession(client, admin, { workspace, email: null, item: itemForLookupKey("pack_200")!, origin });
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "payment", customer: "cus_existing", payment_intent_data: { metadata: { workspace_id: "ws-1", lookup_key: "pack_200" } } }),
    );
  });

  it("refuse un second abonnement : le changement de plan passe par le portail", async () => {
    activeSubscriptions = [{ id: "sub_1" }];
    await expect(createCheckoutSession(client, admin, { workspace, email: null, item: itemForLookupKey("plan_pro_monthly")!, origin })).rejects.toBeInstanceOf(
      AlreadySubscribedError,
    );
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    // Un pack reste possible avec un abonnement.
    await createCheckoutSession(client, admin, { workspace, email: null, item: itemForLookupKey("pack_1000")!, origin });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledOnce();
  });

  it("signale un prix absent du compte Stripe (seed non lancé)", async () => {
    stripe.prices.list.mockResolvedValueOnce({ data: [] });
    await expect(createCheckoutSession(client, admin, { workspace, email: null, item: itemForLookupKey("pack_200")!, origin })).rejects.toThrow(/pnpm stripe:seed/);
  });
});

describe("createPortalSession", () => {
  it("ouvre le portail du client Stripe du workspace, retour sur la facturation", async () => {
    customerId = "cus_existing";
    expect(await createPortalSession(client, admin, { workspace, origin })).toBe("https://billing.stripe.com/p/session/1");
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_existing",
      return_url: "http://localhost:3000/w/mon-espace/billing",
      locale: "fr",
    });
  });
});

describe("stripeCanceler", () => {
  const missing = () => new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", code: "resource_missing", message: "No such subscription" });

  it("résilie chaque abonnement immédiatement, une seule fois par abonnement", async () => {
    stripe.subscriptions.cancel.mockResolvedValue({ status: "canceled" });
    await stripeCanceler(client)(["sub_1", "sub_2"]);
    expect(stripe.subscriptions.cancel.mock.calls).toEqual([
      ["sub_1", undefined, { idempotencyKey: "cancel:sub_1" }],
      ["sub_2", undefined, { idempotencyKey: "cancel:sub_2" }],
    ]);
  });

  it("tient pour annulé un abonnement disparu ou déjà résilié, et rejette sinon", async () => {
    stripe.subscriptions.cancel.mockRejectedValueOnce(missing());
    await expect(stripeCanceler(client)(["sub_gone"])).resolves.toBeUndefined();

    stripe.subscriptions.cancel.mockRejectedValueOnce(new Error("déjà résilié"));
    stripe.subscriptions.retrieve.mockResolvedValueOnce({ status: "canceled" });
    await expect(stripeCanceler(client)(["sub_done"])).resolves.toBeUndefined();

    stripe.subscriptions.cancel.mockRejectedValueOnce(new Error("Stripe indisponible"));
    stripe.subscriptions.retrieve.mockResolvedValueOnce({ status: "active" });
    await expect(stripeCanceler(client)(["sub_active"])).rejects.toThrow("Stripe indisponible");
  });
});
