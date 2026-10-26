import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import type { SubscriptionCanceler } from "@/lib/account/delete";
import { serverEnv } from "@/lib/env/server";
import type { Database } from "@/lib/supabase/database.types";
import type { CatalogItem } from "./plans";

// Client Stripe et opérations lancées par l'utilisateur (tâche 3.3) : Checkout, Customer Portal,
// annulation à la suppression du compte. Les crédits ne sont jamais écrits ici : seule la
// synchronisation des webhooks (stripe-sync.ts) le fait, après relecture de l'objet Stripe.

// STRIPE_SECRET_KEY absente (local, CI) : la page de facturation l'indique, rien n'est tenté.
export class BillingUnavailableError extends Error {
  constructor() {
    super("Paiement indisponible : STRIPE_SECRET_KEY n'est pas configurée.");
    this.name = "BillingUnavailableError";
  }
}

// Un abonnement actif se modifie dans le Customer Portal, pas par un second Checkout.
export class AlreadySubscribedError extends Error {
  constructor() {
    super("Ce workspace a déjà un abonnement : changez de plan depuis le portail de facturation.");
    this.name = "AlreadySubscribedError";
  }
}

export const billingEnabled = () => Boolean(serverEnv.STRIPE_SECRET_KEY);

let client: Stripe | undefined;
export function getStripe(): Stripe {
  if (!serverEnv.STRIPE_SECRET_KEY) throw new BillingUnavailableError();
  return (client ??= new Stripe(serverEnv.STRIPE_SECRET_KEY));
}

type Db = SupabaseClient<Database>;
export type BillingWorkspace = { id: string; slug: string; name: string };

// Statuts qui donnent accès au plan, comme stripe_apply_subscription (migration 0011).
export const ACCESS_STATUSES = ["active", "trialing", "past_due"];

async function priceFor(stripe: Stripe, lookupKey: string): Promise<Stripe.Price> {
  const [price] = (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data;
  if (!price) throw new Error(`Prix Stripe introuvable pour ${lookupKey} : lancez pnpm stripe:seed`);
  return price;
}

// Client Stripe du workspace, créé au premier achat. La clé d'idempotence évite deux clients pour
// deux clics simultanés.
async function ensureCustomer(stripe: Stripe, admin: Db, workspace: BillingWorkspace, email: string | null): Promise<string> {
  const { data, error } = await admin.from("workspaces").select("stripe_customer_id").eq("id", workspace.id).single();
  if (error) throw new Error(`Client Stripe du workspace ${workspace.id} : ${error.message}`);
  if (data.stripe_customer_id) return data.stripe_customer_id;

  const customer = await stripe.customers.create(
    { name: workspace.name, email: email ?? undefined, metadata: { workspace_id: workspace.id } },
    { idempotencyKey: `customer:${workspace.id}` },
  );
  const { error: linkError } = await admin.rpc("stripe_link_customer", { p_workspace: workspace.id, p_customer: customer.id });
  if (linkError) throw new Error(`Client Stripe du workspace ${workspace.id} : ${linkError.message}`);
  return customer.id;
}

export async function hasAccessSubscription(admin: Db, workspaceId: string) {
  const { data, error } = await admin.from("subscriptions").select("id").eq("workspace_id", workspaceId).in("status", ACCESS_STATUSES).limit(1);
  if (error) throw new Error(`Abonnements du workspace ${workspaceId} : ${error.message}`);
  return data.length > 0;
}

const billingUrl = (origin: string, slug: string, query: string) => `${origin}/w/${slug}/billing?${query}`;

// Session Checkout d'un plan (abonnement) ou d'un pack (paiement unique). Les métadonnées portent le
// workspace : la synchronisation s'en sert, jamais du navigateur.
export async function createCheckoutSession(
  stripe: Stripe,
  admin: Db,
  {
    workspace,
    email,
    item,
    origin,
    consentMessage,
    userId,
  }: { workspace: BillingWorkspace; email: string | null; item: CatalogItem; origin: string; consentMessage?: string; userId?: string },
): Promise<string> {
  if (item.type === "plan" && (await hasAccessSubscription(admin, workspace.id))) throw new AlreadySubscribedError();

  const [price, customer] = await Promise.all([priceFor(stripe, item.lookupKey), ensureCustomer(stripe, admin, workspace, email)]);
  // user_id : rattache le paiement au funnel de la personne qui l'a lancé (tâche 5.3).
  const metadata = { workspace_id: workspace.id, lookup_key: item.lookupKey, ...(userId && { user_id: userId }) };
  const session = await stripe.checkout.sessions.create({
    mode: item.type === "plan" ? "subscription" : "payment",
    customer,
    line_items: [{ price: price.id, quantity: 1 }],
    metadata,
    ...(item.type === "plan" ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
    success_url: billingUrl(origin, workspace.slug, "success=1"),
    cancel_url: billingUrl(origin, workspace.slug, "canceled=1"),
    locale: "fr",
    // Rappel des CGU sous le bouton de paiement (tâche 5.2). La case à cocher de Stripe
    // (consent_collection) demande l'URL des CGU dans le Dashboard : à activer à la mise en production.
    ...(consentMessage && { custom_text: { submit: { message: consentMessage } } }),
  });
  if (!session.url) throw new Error(`Session Checkout ${session.id} sans URL`);
  return session.url;
}

// Customer Portal : changement de plan, moyen de paiement, factures, résiliation.
export async function createPortalSession(stripe: Stripe, admin: Db, { workspace, origin }: { workspace: BillingWorkspace; origin: string }): Promise<string> {
  const { data, error } = await admin.from("workspaces").select("stripe_customer_id").eq("id", workspace.id).single();
  if (error) throw new Error(`Client Stripe du workspace ${workspace.id} : ${error.message}`);
  if (!data.stripe_customer_id) throw new Error(`Le workspace ${workspace.id} n'a pas encore de client Stripe`);
  const session = await stripe.billingPortal.sessions.create({ customer: data.stripe_customer_id, return_url: `${origin}/w/${workspace.slug}/billing`, locale: "fr" });
  return session.url;
}

// Suppression du compte (tâche 2.6) : résiliation immédiate. Un abonnement déjà résilié chez Stripe
// compte comme annulé.
export const stripeCanceler =
  (stripe: Stripe): SubscriptionCanceler =>
  async (subscriptionIds) => {
    for (const id of subscriptionIds) {
      try {
        await stripe.subscriptions.cancel(id, undefined, { idempotencyKey: `cancel:${id}` });
      } catch (error) {
        if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") continue;
        const subscription = await stripe.subscriptions.retrieve(id).catch(() => null);
        if (subscription?.status === "canceled") continue;
        throw error;
      }
    }
  };
