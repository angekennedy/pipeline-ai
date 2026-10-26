import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { track } from "@/lib/analytics/posthog";
import type { Database } from "@/lib/supabase/database.types";
import { PLANS, isPlanKey, itemForLookupKey, type Plan } from "./plans";

// Traitement d'un événement Stripe (tâche 3.4, ARCHITECTURE §5.3), lancé par la fonction Inngest
// stripe-sync après le webhook. Rien n'est cru du payload : l'événement puis son objet sont relus
// chez Stripe, ce qui rend l'ordre d'arrivée indifférent. Chaque écriture est idempotente
// (migration 0011) : rejouer un événement ne crédite pas deux fois.

// Lectures Stripe nécessaires, remplaçables par des fixtures dans les tests.
export type StripeReader = {
  event(id: string): Promise<{ id: string; type: string; objectId: string | null }>;
  checkoutSession(id: string): Promise<Stripe.Checkout.Session>; // line_items.data.price développés
  subscription(id: string): Promise<Stripe.Subscription>;
  invoice(id: string): Promise<Stripe.Invoice>;
  charge(id: string): Promise<Stripe.Charge>;
};

export const stripeReader = (stripe: Stripe): StripeReader => ({
  event: async (id) => {
    const event = await stripe.events.retrieve(id);
    const object = event.data.object as { id?: unknown };
    return { id: event.id, type: event.type, objectId: typeof object.id === "string" ? object.id : null };
  },
  checkoutSession: (id) => stripe.checkout.sessions.retrieve(id, { expand: ["line_items.data.price"] }),
  subscription: (id) => stripe.subscriptions.retrieve(id),
  invoice: (id) => stripe.invoices.retrieve(id),
  charge: (id) => stripe.charges.retrieve(id),
});

// `action` : ce qui a été fait, ou `ignored:<raison>` quand l'événement ne concerne rien de connu.
export type SyncResult = { type: string; action: string; workspaceId?: string };

type Db = SupabaseClient<Database>;
// `track` : funnel PostHog (tâche 5.3), remplacé dans les tests.
type Deps = { stripe: StripeReader; db: Db; now?: () => Date; track?: typeof track };

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === "string" ? value : (value?.id ?? null));

async function rpc<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`${what} : ${error.message}`);
  return data;
}

// Workspace d'un objet Stripe : métadonnées posées côté serveur à la création de la session, sinon
// le client Stripe lié au workspace.
async function workspaceFor(db: Db, metadata: Stripe.Metadata | null | undefined, customer: string | null): Promise<string | null> {
  if (metadata?.workspace_id) return metadata.workspace_id;
  if (!customer) return null;
  const { data, error } = await db.from("workspaces").select("id").eq("stripe_customer_id", customer).maybeSingle();
  if (error) throw new Error(`Workspace du client ${customer} : ${error.message}`);
  return data?.id ?? null;
}

function planOf(subscription: Stripe.Subscription): { plan: Plan; item: Stripe.SubscriptionItem } | null {
  for (const item of subscription.items.data) {
    const found = itemForLookupKey(item.price.lookup_key);
    if (found?.type === "plan") return { plan: found.plan, item };
  }
  return null;
}

// Abonnement relu : état enregistré, plan du workspace, et crédits différentiels d'un upgrade en
// cours de période, au prorata du temps restant.
async function syncSubscription({ stripe, db, now = () => new Date() }: Deps, subscriptionId: string): Promise<{ result: SyncResult; plan?: Plan }> {
  const subscription = await stripe.subscription(subscriptionId);
  const workspaceId = await workspaceFor(db, subscription.metadata, idOf(subscription.customer));
  if (!workspaceId) return { result: { type: "subscription", action: "ignored:unknown_workspace" } };
  const found = planOf(subscription);
  if (!found) return { result: { type: "subscription", action: "ignored:unknown_price", workspaceId } };

  const { plan, item } = found;
  const previous = await rpc(
    db.rpc("stripe_apply_subscription", {
      p_workspace: workspaceId,
      p_subscription: subscription.id,
      p_status: subscription.status,
      p_price: item.price.id,
      p_plan: plan.key,
      p_period_end: new Date(item.current_period_end * 1000).toISOString(),
      p_cancel_at_period_end: subscription.cancel_at_period_end,
    }),
    `Abonnement ${subscription.id}`,
  );

  // Upgrade d'un plan payant vers un plan plus généreux : la facture de régularisation ne passe pas par
  // invoice.paid (billing_reason subscription_update), les crédits sont donc donnés ici. Le passage de
  // Free à un plan payant est crédité par la première facture (subscription_create).
  const before = previous && isPlanKey(previous) && previous !== "free" ? PLANS[previous] : null;
  if (subscription.status === "active" && before && plan.credits > before.credits) {
    const start = item.current_period_start * 1000;
    const end = item.current_period_end * 1000;
    const remaining = Math.min(1, Math.max(0, (end - now().getTime()) / (end - start)));
    const credits = Math.floor((plan.credits - before.credits) * remaining);
    if (credits > 0) {
      await rpc(
        db.rpc("stripe_credit", {
          p_workspace: workspaceId,
          p_kind: "grant",
          p_amount: credits,
          p_key: `stripe:upg:${subscription.id}:${item.current_period_start}:${plan.key}`,
          p_ref: subscription.id,
          p_meta: { reason: "upgrade", from: before.key, to: plan.key },
        }),
        `Upgrade ${subscription.id}`,
      );
      return { result: { type: "subscription", action: "upgraded", workspaceId }, plan };
    }
  }
  return { result: { type: "subscription", action: "synced", workspaceId }, plan };
}

// Paiement encaissé : dernière étape du funnel, pour la personne qui a lancé le paiement. Un webhook
// relivré garde le même identifiant d'événement (session Stripe).
async function trackPayment(deps: Deps, session: Stripe.Checkout.Session) {
  const userId = session.metadata?.user_id;
  if (!userId || session.payment_status !== "paid") return;
  const kind = session.mode === "subscription" ? "plan" : "pack";
  await (deps.track ?? track)(userId, { name: "payment_completed", properties: { kind, offer: session.metadata?.lookup_key ?? "unknown" } }, session.id);
}

async function syncCheckout(deps: Deps, sessionId: string): Promise<SyncResult> {
  const session = await deps.stripe.checkoutSession(sessionId);
  const customer = idOf(session.customer);
  const workspaceId = await workspaceFor(deps.db, session.metadata, customer);
  if (!workspaceId) return { type: "checkout", action: "ignored:unknown_workspace" };
  if (customer) await rpc(deps.db.rpc("stripe_link_customer", { p_workspace: workspaceId, p_customer: customer }), `Client ${customer}`);
  await trackPayment(deps, session);

  if (session.mode === "subscription") {
    const subscription = idOf(session.subscription);
    if (subscription) await syncSubscription(deps, subscription);
    return { type: "checkout", action: "subscription", workspaceId };
  }

  // Paiement unique : un pack, crédité une fois le paiement encaissé (un moyen différé arrive par
  // checkout.session.async_payment_succeeded).
  if (session.payment_status !== "paid") return { type: "checkout", action: "ignored:unpaid", workspaceId };
  const item = itemForLookupKey(session.line_items?.data[0]?.price?.lookup_key);
  if (item?.type !== "pack") return { type: "checkout", action: "ignored:unknown_price", workspaceId };
  await rpc(
    deps.db.rpc("stripe_credit", {
      p_workspace: workspaceId,
      p_kind: "purchase",
      p_amount: item.credits,
      p_key: `stripe:cs:${session.id}`,
      p_ref: idOf(session.payment_intent) ?? session.id,
      p_meta: { reason: "pack", session: session.id },
    }),
    `Pack ${session.id}`,
  );
  return { type: "checkout", action: "purchase", workspaceId };
}

const subscriptionOfInvoice = (invoice: Stripe.Invoice) => idOf(invoice.parent?.subscription_details?.subscription);

// Facture payée à la création ou au renouvellement : report plafonné puis allocation du plan.
async function syncInvoicePaid(deps: Deps, invoiceId: string): Promise<SyncResult> {
  const invoice = await deps.stripe.invoice(invoiceId);
  const subscriptionId = subscriptionOfInvoice(invoice);
  if (!subscriptionId) return { type: "invoice", action: "ignored:no_subscription" };
  const { result, plan } = await syncSubscription(deps, subscriptionId);
  const { workspaceId } = result;
  if (!workspaceId || !plan) return { type: "invoice", action: result.action, workspaceId };
  if (invoice.billing_reason !== "subscription_create" && invoice.billing_reason !== "subscription_cycle") {
    return { type: "invoice", action: "ignored:billing_reason", workspaceId };
  }
  if (invoice.status !== "paid") return { type: "invoice", action: "ignored:unpaid", workspaceId };
  await rpc(
    deps.db.rpc("stripe_renew", {
      p_workspace: workspaceId,
      p_invoice: invoice.id,
      p_allocation: plan.credits,
      p_meta: { reason: invoice.billing_reason, plan: plan.key },
    }),
    `Facture ${invoice.id}`,
  );
  return { type: "invoice", action: "renewed", workspaceId };
}

// Remboursement d'un pack : les crédits de la part remboursée sont retirés, sans passer sous le
// réservé (credit_op). Un remboursement d'abonnement n'est pas rapproché automatiquement : il
// ressort en `ignored:unmatched`, pour la réconciliation (tâche 4.6).
async function syncRefund(deps: Deps, chargeId: string): Promise<SyncResult> {
  const charge = await deps.stripe.charge(chargeId);
  const paymentIntent = idOf(charge.payment_intent);
  if (!paymentIntent || charge.amount <= 0) return { type: "refund", action: "ignored:unmatched" };
  const { data: purchases, error } = await deps.db
    .from("credit_ledger")
    .select("workspace_id, amount")
    .eq("stripe_ref", paymentIntent)
    .eq("kind", "purchase")
    .limit(1);
  if (error) throw new Error(`Achat du paiement ${paymentIntent} : ${error.message}`);
  const purchase = purchases[0];
  if (!purchase) return { type: "refund", action: "ignored:unmatched" };

  // Remboursements partiels successifs : on retire ce qui manque pour atteindre la part remboursée.
  const { data: adjusted, error: adjustedError } = await deps.db.from("credit_ledger").select("amount").eq("stripe_ref", charge.id).eq("kind", "adjust");
  if (adjustedError) throw new Error(`Remboursements du paiement ${charge.id} : ${adjustedError.message}`);
  const target = Math.round((purchase.amount * Math.min(charge.amount_refunded, charge.amount)) / charge.amount);
  const credits = target - adjusted.reduce((sum, row) => sum + row.amount, 0);
  if (credits <= 0) return { type: "refund", action: "unchanged", workspaceId: purchase.workspace_id };
  await rpc(
    deps.db.rpc("stripe_credit", {
      p_workspace: purchase.workspace_id,
      p_kind: "adjust",
      p_amount: credits,
      p_key: `stripe:refund:${charge.id}:${charge.amount_refunded}`,
      p_ref: charge.id,
      p_meta: { reason: "refund", amount_refunded: charge.amount_refunded },
    }),
    `Remboursement ${charge.id}`,
  );
  return { type: "refund", action: "adjusted", workspaceId: purchase.workspace_id };
}

// Événements transmis à stripe-sync par le webhook ; les autres sont enregistrés puis ignorés.
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
] as const;

async function dispatch(deps: Deps, type: string, objectId: string): Promise<SyncResult> {
  switch (type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return syncCheckout(deps, objectId);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return (await syncSubscription(deps, objectId)).result;
    case "invoice.paid":
      return syncInvoicePaid(deps, objectId);
    case "invoice.payment_failed": {
      // Le statut past_due de l'abonnement bloque les nouveaux pipelines (migration 0008).
      const subscription = subscriptionOfInvoice(await deps.stripe.invoice(objectId));
      return subscription ? (await syncSubscription(deps, subscription)).result : { type: "invoice", action: "ignored:no_subscription" };
    }
    case "charge.refunded":
      return syncRefund(deps, objectId);
    default:
      return { type, action: "ignored:event_type" };
  }
}

export async function syncStripeEvent(eventId: string, deps: Deps): Promise<SyncResult> {
  const { type, objectId } = await deps.stripe.event(eventId);
  const result = objectId ? await dispatch(deps, type, objectId) : { type, action: "ignored:no_object" };
  const { error } = await deps.db.from("stripe_events").update({ processed_at: new Date().toISOString() }).eq("id", eventId);
  if (error) throw new Error(`Événement ${eventId} : ${error.message}`);
  return result;
}
