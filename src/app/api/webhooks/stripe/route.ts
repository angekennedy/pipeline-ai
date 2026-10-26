import Stripe from "stripe";
import { HANDLED_EVENTS } from "@/lib/billing/stripe-sync";
import { serverEnv } from "@/lib/env/server";
import { inngest } from "@/lib/jobs/client";
import { stripeEventReceived } from "@/lib/jobs/events";
import { createAdminClient } from "@/lib/supabase/admin";

// Webhook Stripe (ARCHITECTURE §5.3) : signature vérifiée sur le corps brut, événement enregistré une
// seule fois (stripe_events), traitement confié à la fonction Inngest stripe-sync. Répond vite : Stripe
// renvoie l'événement tant qu'il n'a pas reçu de 2xx.

const handled = new Set<string>(HANDLED_EVENTS);
// La signature se vérifie sans appel réseau : la clé ne sert qu'à construire le client.
const webhooks = new Stripe("sk_webhook_verification_only").webhooks;

export async function POST(request: Request): Promise<Response> {
  const secret = serverEnv.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook Stripe non configuré", { status: 503 });

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = webhooks.constructEvent(body, request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return new Response("Signature invalide", { status: 400 });
  }

  const admin = createAdminClient();
  const isHandled = handled.has(event.type);
  const { error } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type, processed_at: isHandled ? null : new Date().toISOString() });
  if (error?.code === "23505") return new Response("Déjà reçu", { status: 200 });
  if (error) return new Response("Enregistrement impossible", { status: 500 });
  if (!isHandled) return new Response("Ignoré", { status: 200 });

  try {
    await inngest.send(stripeEventReceived.create({ id: event.id }, { id: event.id }));
  } catch {
    // Non transmis : l'enregistrement est retiré pour que le renvoi de Stripe soit traité.
    await admin.from("stripe_events").delete().eq("id", event.id);
    return new Response("Traitement indisponible", { status: 500 });
  }
  return new Response("ok", { status: 200 });
}
