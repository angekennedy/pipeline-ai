// Bouchon Inngest des e2e (inngest-stub.mjs) : événements reçus depuis le démarrage du serveur.
export const INNGEST_STUB = "http://127.0.0.1:8288";

type SentEvent = { name: string; id?: string; data: Record<string, unknown> };

export async function sentEvents(): Promise<SentEvent[]> {
  const response = await fetch(`${INNGEST_STUB}/events`);
  return (await response.json()) as SentEvent[];
}
