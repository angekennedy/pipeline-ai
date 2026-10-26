import "server-only";
import { createHash } from "node:crypto";
import { serverEnv } from "@/lib/env/server";

// Funnel inscription → premier pipeline → paiement (tâche 5.3), envoyé à PostHog côté serveur par
// son API HTTP : ni script dans le navigateur, ni cookie. Aucune donnée personnelle :
// - l'identifiant est une empreinte SHA-256 de l'id utilisateur, non réversible (un UUID aléatoire) ;
// - ni e-mail, ni IP, ni contenu de brief ; pas de profil de personne ni de géolocalisation.
// Sans POSTHOG_KEY (local, CI), rien n'est envoyé. Une panne de PostHog n'interrompt jamais le
// parcours : l'envoi est borné à 2 s et ses erreurs sont seulement journalisées.

export type AnalyticsEvent =
  | { name: "signed_up"; properties: { method: "email" | "google" } }
  | { name: "pipeline_created"; properties: { tier: "standard" | "premium"; minutes: number } }
  | { name: "payment_completed"; properties: { kind: "plan" | "pack"; offer: string } };

export const analyticsId = (userId: string) => createHash("sha256").update(`pipeline-ai:${userId}`).digest("hex").slice(0, 32);

// Premier retour d'un compte créé il y a moins de 15 min : une inscription, pas une reconnexion.
export const isNewAccount = (createdAt: string | undefined, now = new Date()) => Boolean(createdAt) && now.getTime() - Date.parse(createdAt!) < 15 * 60_000;

// UUID déterministe : un même fait rejoué (webhook relivré, lien rouvert) garde le même identifiant,
// que PostHog dédoublonne.
export function eventUuid(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

type Options = { key?: string; host?: string; fetch?: typeof fetch; now?: () => Date };

export async function track(
  userId: string,
  event: AnalyticsEvent,
  dedupeKey: string,
  { key = serverEnv.POSTHOG_KEY, host = serverEnv.POSTHOG_HOST, fetch: send = fetch, now = () => new Date() }: Options = {},
): Promise<void> {
  if (!key) return;
  try {
    const response = await send(new URL("/i/v0/e/", host), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event: event.name,
        distinct_id: analyticsId(userId),
        uuid: eventUuid(`${event.name}:${dedupeKey}`),
        timestamp: now().toISOString(),
        properties: { ...event.properties, $process_person_profile: false, $geoip_disable: true },
      }),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) console.warn(`PostHog : ${event.name} refusé (${response.status})`);
  } catch (error) {
    console.warn(`PostHog : ${event.name} non envoyé`, error instanceof Error ? error.message : error);
  }
}
