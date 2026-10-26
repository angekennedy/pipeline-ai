import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { StripeReader } from "@/lib/billing/stripe-sync";

// Objets Stripe minimaux, au format de l'API actuelle (périodes sur les éléments d'abonnement,
// abonnement d'une facture sous `parent.subscription_details`), et lecteur Stripe en mémoire : la
// synchronisation relit ce que le test y a placé, comme elle relirait l'API.

const rand = () => randomUUID().replaceAll("-", "").slice(0, 14);
export const stripeId = (prefix: string) => `${prefix}_test${rand()}`;

const DAY = 86_400;

export function subscription({
  id = stripeId("sub"),
  customer,
  workspaceId,
  lookupKey,
  status = "active",
  periodStart = Math.floor(Date.parse("2026-10-01T00:00:00Z") / 1000),
  cancelAtPeriodEnd = false,
}: {
  id?: string;
  customer: string;
  workspaceId?: string;
  lookupKey: string;
  status?: Stripe.Subscription.Status;
  periodStart?: number;
  cancelAtPeriodEnd?: boolean;
}): Stripe.Subscription {
  return {
    id,
    object: "subscription",
    customer,
    status,
    cancel_at_period_end: cancelAtPeriodEnd,
    metadata: workspaceId ? { workspace_id: workspaceId } : {},
    items: {
      object: "list",
      data: [
        {
          id: stripeId("si"),
          object: "subscription_item",
          price: { id: `price_${lookupKey}`, object: "price", lookup_key: lookupKey } as Stripe.Price,
          current_period_start: periodStart,
          current_period_end: periodStart + 30 * DAY,
        } as Stripe.SubscriptionItem,
      ],
    },
  } as unknown as Stripe.Subscription;
}

export function invoice({
  id = stripeId("in"),
  subscription: sub,
  billingReason,
  status = "paid",
}: {
  id?: string;
  subscription: string;
  billingReason: Stripe.Invoice.BillingReason;
  status?: Stripe.Invoice.Status;
}): Stripe.Invoice {
  return {
    id,
    object: "invoice",
    status,
    billing_reason: billingReason,
    parent: { type: "subscription_details", subscription_details: { subscription: sub } },
  } as unknown as Stripe.Invoice;
}

export function checkoutSession({
  id = stripeId("cs"),
  customer,
  workspaceId,
  mode,
  subscription: sub = null,
  lookupKey,
  paymentStatus = "paid",
  paymentIntent = mode === "payment" ? stripeId("pi") : null,
}: {
  id?: string;
  customer: string;
  workspaceId: string;
  mode: Stripe.Checkout.Session.Mode;
  subscription?: string | null;
  lookupKey: string;
  paymentStatus?: Stripe.Checkout.Session.PaymentStatus;
  paymentIntent?: string | null;
}): Stripe.Checkout.Session {
  return {
    id,
    object: "checkout.session",
    customer,
    mode,
    subscription: sub,
    payment_status: paymentStatus,
    payment_intent: paymentIntent,
    metadata: { workspace_id: workspaceId, lookup_key: lookupKey },
    line_items: { object: "list", data: [{ price: { id: `price_${lookupKey}`, lookup_key: lookupKey } }] },
  } as unknown as Stripe.Checkout.Session;
}

export function charge({ id = stripeId("ch"), paymentIntent, amount, refunded }: { id?: string; paymentIntent: string; amount: number; refunded: number }): Stripe.Charge {
  return { id, object: "charge", payment_intent: paymentIntent, amount, amount_refunded: refunded } as unknown as Stripe.Charge;
}

// Lecteur Stripe en mémoire : chaque objet est relu par son id, comme le ferait l'API. `emit` crée
// l'événement qui le désigne.
export class FakeStripe implements StripeReader {
  private readonly objects = new Map<string, unknown>();
  private readonly events = new Map<string, { id: string; type: string; objectId: string }>();
  readonly reads: string[] = [];

  put<T extends { id: string }>(object: T): T {
    this.objects.set(object.id, object);
    return object;
  }

  emit(type: string, object: { id: string }): string {
    const id = stripeId("evt");
    this.events.set(id, { id, type, objectId: object.id });
    return id;
  }

  private read<T>(id: string): T {
    this.reads.push(id);
    const object = this.objects.get(id);
    if (!object) throw new Error(`Objet Stripe inconnu : ${id}`);
    return structuredClone(object) as T;
  }

  event = async (id: string) => {
    const event = this.events.get(id);
    if (!event) throw new Error(`Événement Stripe inconnu : ${id}`);
    return event;
  };
  checkoutSession = async (id: string) => this.read<Stripe.Checkout.Session>(id);
  subscription = async (id: string) => this.read<Stripe.Subscription>(id);
  invoice = async (id: string) => this.read<Stripe.Invoice>(id);
  charge = async (id: string) => this.read<Stripe.Charge>(id);
}
