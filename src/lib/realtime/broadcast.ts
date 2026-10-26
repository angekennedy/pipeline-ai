import { SceneStreamParser } from "@/lib/ai/partial-json";
import type { Scene } from "@/lib/ai/schemas/script";
import type { PipelineEvent, PipelineEventPublisher } from "./events";

// Au plus 4 messages par seconde par pipeline (quota Realtime, et l'œil n'en voit pas plus).
const MIN_INTERVAL_MS = 250;

// L'affichage en direct est un confort : un envoi en échec ne doit jamais faire échouer la génération.
export async function safePublish(publish: PipelineEventPublisher | undefined, event: PipelineEvent): Promise<void> {
  if (!publish) return;
  try {
    await publish(event);
  } catch (error) {
    console.warn(`Broadcast ${event.type} non envoyé`, error);
  }
}

// Branché sur `onText` du stream du script : envoie les scènes complètes, regroupées, à intervalle
// minimal. Chaque appel à l'API (réparation, relance sur max_tokens) ouvre un nouveau stream dont le
// JSON repart de zéro : le parseur est alors réinitialisé et les scènes renvoyées, que le navigateur
// remplace par index.
export function createSceneThrottle(publish: PipelineEventPublisher) {
  let parser = new SceneStreamParser();
  let pending: Scene[] = [];
  let lastSentAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const inFlight = new Set<Promise<void>>();

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const send = () => {
    clearTimer();
    if (pending.length === 0) return;
    const scenes = pending;
    pending = [];
    lastSentAt = Date.now();
    const sending = safePublish(publish, { type: "asset.partial", asset: "script", scenes });
    inFlight.add(sending);
    void sending.finally(() => inFlight.delete(sending));
  };

  return {
    onText(delta: string, snapshot: string) {
      if (snapshot.length === delta.length) parser = new SceneStreamParser();
      pending.push(...parser.push(delta));
      if (pending.length === 0 || timer) return;
      const wait = lastSentAt + MIN_INTERVAL_MS - Date.now();
      if (wait <= 0) send();
      else timer = setTimeout(send, wait);
    },
    // Fin du stream : envoie ce qui reste avant l'événement asset.completed.
    async flush() {
      send();
      await Promise.all(inFlight);
    },
    // Génération en échec : rien de plus à afficher.
    cancel() {
      clearTimer();
      pending = [];
    },
  };
}
