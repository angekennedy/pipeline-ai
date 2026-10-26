import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Brief } from "@/lib/ai/schemas";
import { getCreditSummary } from "@/lib/billing/balance";
import { PlanRestrictionError } from "@/lib/billing/entitlements";
import { createPipelineWithReservation } from "@/lib/billing/reservation";
import { syncStripeEvent } from "@/lib/billing/stripe-sync";
import { validBrief } from "../fixtures/assets";
import { FakeStripe, charge, checkoutSession, invoice, stripeId, subscription } from "../fixtures/stripe";
import { admin, cleanup, createUser, unwrap, type TestUser } from "./helpers";

// Synchronisation Stripe (tâche 3.4) sur la vraie base : événements de fixture, objets relus par un
// lecteur Stripe en mémoire. Chaque scénario rejoue ses événements pour prouver l'idempotence.

afterAll(cleanup);

let stripe: FakeStripe;
let user: TestUser;
let ws: string;
let customer: string;

beforeEach(async () => {
  stripe = new FakeStripe();
  user = await createUser("stripe");
  ws = unwrap(await admin.from("workspace_members").select("workspace_id").eq("user_id", user.id).single()).workspace_id;
  customer = stripeId("cus");
});

const sync = (eventId: string, now?: Date) => syncStripeEvent(eventId, { stripe, db: admin, now: now ? () => now : undefined });
const balance = async () => (await getCreditSummary(admin, ws)).balance;
const plan = async () => unwrap(await admin.from("workspaces").select("plan_key").eq("id", ws).single()).plan_key;
const ledger = async () =>
  unwrap(await admin.from("credit_ledger").select("kind, amount, idempotency_key, stripe_ref").eq("workspace_id", ws).order("id")).filter(
    (row) => !row.idempotency_key.startsWith("grant:signup"),
  );

// Abonnement souscrit par Checkout : la session, l'abonnement et la première facture.
async function subscribe(lookupKey = "plan_creator_monthly") {
  const sub = stripe.put(subscription({ customer, workspaceId: ws, lookupKey }));
  const session = stripe.put(checkoutSession({ customer, workspaceId: ws, mode: "subscription", subscription: sub.id, lookupKey }));
  const first = stripe.put(invoice({ subscription: sub.id, billingReason: "subscription_create" }));
  return {
    sub,
    events: [stripe.emit("checkout.session.completed", session), stripe.emit("customer.subscription.created", sub), stripe.emit("invoice.paid", first)],
  };
}

describe("abonnement", () => {
  it("Checkout puis première facture : client lié, plan Creator, 400 crédits, une seule fois", async () => {
    const { sub, events } = await subscribe();
    const results = [];
    for (const id of events) results.push(await sync(id));
    expect(results).toEqual([
      { type: "checkout", action: "subscription", workspaceId: ws },
      { type: "subscription", action: "synced", workspaceId: ws },
      { type: "invoice", action: "renewed", workspaceId: ws },
    ]);
    expect(unwrap(await admin.from("workspaces").select("stripe_customer_id, plan_key").eq("id", ws).single())).toEqual({
      stripe_customer_id: customer,
      plan_key: "creator",
    });
    expect(unwrap(await admin.from("subscriptions").select("id, status, plan_key").eq("workspace_id", ws))).toEqual([
      { id: sub.id, status: "active", plan_key: "creator" },
    ]);
    expect(await balance()).toBe(30 + 400);

    // Rejeu complet, dans le désordre : rien ne change.
    for (const id of events.toReversed()) await sync(id);
    expect(await balance()).toBe(430);
    expect(await ledger()).toEqual([
      { kind: "grant", amount: 400, idempotency_key: expect.stringMatching(/^stripe:inv:in_/), stripe_ref: expect.stringMatching(/^in_/) },
    ]);
  });

  it("facture reçue avant le Checkout : le workspace vient des métadonnées de l'abonnement", async () => {
    const { events } = await subscribe();
    await sync(events[2]!);
    expect(await plan()).toBe("creator");
    expect(await balance()).toBe(430);
  });

  it("renouvellement : report plafonné à une allocation, puis nouvelle allocation", async () => {
    const { sub, events } = await subscribe();
    for (const id of events) await sync(id);
    unwrap(await admin.rpc("stripe_credit", { p_workspace: ws, p_kind: "purchase", p_amount: 1000, p_key: `test:${randomUUID()}`, p_ref: "pi_test" }));
    expect(await balance()).toBe(1430);

    const renewal = stripe.emit("invoice.paid", stripe.put(invoice({ subscription: sub.id, billingReason: "subscription_cycle" })));
    await sync(renewal);
    await sync(renewal);
    expect(await balance()).toBe(400 + 400); // 1 030 au-delà du plafond expirés
    expect((await ledger()).map(({ kind, amount }) => [kind, amount])).toEqual([
      ["grant", 400],
      ["purchase", 1000],
      ["expire", 1030],
      ["grant", 400],
    ]);
  });

  it("ne crédite pas une facture de régularisation ni une facture impayée", async () => {
    const { sub, events } = await subscribe();
    for (const id of events) await sync(id);
    const update = stripe.emit("invoice.paid", stripe.put(invoice({ subscription: sub.id, billingReason: "subscription_update" })));
    const unpaid = stripe.emit("invoice.paid", stripe.put(invoice({ subscription: sub.id, billingReason: "subscription_cycle", status: "open" })));
    expect(await sync(update)).toMatchObject({ action: "ignored:billing_reason" });
    expect(await sync(unpaid)).toMatchObject({ action: "ignored:unpaid" });
    expect(await balance()).toBe(430);
  });

  it("upgrade Creator → Pro à mi-période : la différence au prorata, une seule fois", async () => {
    const { sub, events } = await subscribe();
    for (const id of events) await sync(id);
    const start = sub.items.data[0]!.current_period_start;
    const midPeriod = new Date((start + 15 * 86_400) * 1000);
    const upgraded = stripe.put(subscription({ id: sub.id, customer, workspaceId: ws, lookupKey: "plan_pro_monthly", periodStart: start }));
    const event = stripe.emit("customer.subscription.updated", upgraded);

    expect(await sync(event, midPeriod)).toEqual({ type: "subscription", action: "upgraded", workspaceId: ws });
    expect(await sync(event, midPeriod)).toEqual({ type: "subscription", action: "synced", workspaceId: ws });
    expect(await plan()).toBe("pro");
    expect(await balance()).toBe(430 + 550); // (1 500 − 400) × 15/30
  });

  it("résiliation : plan Free, abonnement résilié, crédits gardés", async () => {
    const { sub, events } = await subscribe();
    for (const id of events) await sync(id);
    const canceled = stripe.put(subscription({ id: sub.id, customer, workspaceId: ws, lookupKey: "plan_creator_monthly", status: "canceled" }));
    await sync(stripe.emit("customer.subscription.deleted", canceled));
    expect(await plan()).toBe("free");
    expect(unwrap(await admin.from("subscriptions").select("status").eq("id", sub.id).single())).toEqual({ status: "canceled" });
    expect(await balance()).toBe(430);
  });

  it("paiement échoué : abonnement en retard et création de pipelines suspendue", async () => {
    const { sub, events } = await subscribe();
    for (const id of events) await sync(id);
    stripe.put(subscription({ id: sub.id, customer, workspaceId: ws, lookupKey: "plan_creator_monthly", status: "past_due" }));
    await sync(stripe.emit("invoice.payment_failed", stripe.put(invoice({ subscription: sub.id, billingReason: "subscription_cycle", status: "open" }))));

    expect(await plan()).toBe("creator"); // lecture conservée
    const error = await createPipelineWithReservation(admin, {
      workspaceId: ws,
      userId: user.id,
      brief: validBrief as Brief,
      tier: "standard",
      idempotencyKey: randomUUID(),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlanRestrictionError);
    expect((error as PlanRestrictionError).restriction).toMatchObject({ reason: "subscription_past_due" });
  });
});

describe("packs de crédits", () => {
  const buyPack = (paymentStatus: "paid" | "unpaid" = "paid") => {
    const session = stripe.put(checkoutSession({ customer, workspaceId: ws, mode: "payment", lookupKey: "pack_200", paymentStatus }));
    return { session, event: stripe.emit("checkout.session.completed", session) };
  };

  it("crédite le pack payé une seule fois, avec la référence du paiement", async () => {
    const { session, event } = buyPack();
    expect(await sync(event)).toEqual({ type: "checkout", action: "purchase", workspaceId: ws });
    await sync(event);
    expect(await balance()).toBe(230);
    expect(await ledger()).toEqual([{ kind: "purchase", amount: 200, idempotency_key: `stripe:cs:${session.id}`, stripe_ref: session.payment_intent }]);
  });

  it("compte le paiement dans le funnel une fois encaissé, pour la personne qui l'a lancé", async () => {
    const track = vi.fn();
    const session = stripe.put(checkoutSession({ customer, workspaceId: ws, mode: "payment", lookupKey: "pack_200", paymentStatus: "unpaid", userId: "user-9" }));
    await syncStripeEvent(stripe.emit("checkout.session.completed", session), { stripe, db: admin, track });
    expect(track).not.toHaveBeenCalled(); // pas encore encaissé
    stripe.put({ ...session, payment_status: "paid" });
    await syncStripeEvent(stripe.emit("checkout.session.async_payment_succeeded", session), { stripe, db: admin, track });
    expect(track).toHaveBeenCalledWith("user-9", { name: "payment_completed", properties: { kind: "pack", offer: "pack_200" } }, session.id);
  });

  it("attend l'encaissement d'un paiement différé", async () => {
    const { session, event } = buyPack("unpaid");
    expect(await sync(event)).toMatchObject({ action: "ignored:unpaid" });
    expect(await balance()).toBe(30);
    stripe.put({ ...session, payment_status: "paid" });
    await sync(stripe.emit("checkout.session.async_payment_succeeded", session));
    expect(await balance()).toBe(230);
  });

  it("retire les crédits remboursés : moitié, puis le reste, sans double retrait", async () => {
    const { session, event } = buyPack();
    await sync(event);
    const paymentIntent = session.payment_intent as string;
    const half = stripe.put(charge({ paymentIntent, amount: 1500, refunded: 750 }));
    const refund = stripe.emit("charge.refunded", half);
    await sync(refund);
    await sync(refund);
    expect(await balance()).toBe(130);

    stripe.put(charge({ id: half.id, paymentIntent, amount: 1500, refunded: 1500 }));
    const rest = stripe.emit("charge.refunded", half);
    await sync(rest);
    await sync(rest);
    expect(await balance()).toBe(30);
    expect((await ledger()).map(({ kind, amount }) => [kind, amount])).toEqual([
      ["purchase", 200],
      ["adjust", 100],
      ["adjust", 100],
    ]);
  });

  it("ne rapproche pas un remboursement inconnu", async () => {
    const unknown = stripe.emit("charge.refunded", stripe.put(charge({ paymentIntent: stripeId("pi"), amount: 1900, refunded: 1900 })));
    expect(await sync(unknown)).toEqual({ type: "refund", action: "ignored:unmatched" });
    expect(await balance()).toBe(30);
  });
});

describe("événements hors catalogue", () => {
  it("ignore un client sans workspace et un prix inconnu, sans rien écrire", async () => {
    const stranger = stripe.put(subscription({ customer: stripeId("cus"), lookupKey: "plan_creator_monthly" }));
    expect(await sync(stripe.emit("customer.subscription.created", stranger))).toEqual({ type: "subscription", action: "ignored:unknown_workspace" });
    const unknownPrice = stripe.put(subscription({ customer, workspaceId: ws, lookupKey: "plan_inconnu" }));
    expect(await sync(stripe.emit("customer.subscription.created", unknownPrice))).toEqual({
      type: "subscription",
      action: "ignored:unknown_price",
      workspaceId: ws,
    });
    expect(await plan()).toBe("free");
    expect(await ledger()).toEqual([]);
  });

  it("marque l'événement traité", async () => {
    const { events } = await subscribe();
    const id = events[0]!;
    unwrap(await admin.from("stripe_events").insert({ id, type: "checkout.session.completed" }).select());
    await sync(id);
    expect(unwrap(await admin.from("stripe_events").select("processed_at").eq("id", id).single()).processed_at).not.toBeNull();
    await admin.from("stripe_events").delete().eq("id", id);
  });
});
