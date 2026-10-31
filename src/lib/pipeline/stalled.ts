// Génération sans activité depuis 30 min : son exécution est perdue (fonction Inngest absente ou non
// synchronisée, échec non remonté). Même délai que le balayage des réservations
// (sweep_stale_reservations), qui en a déjà rendu les crédits. Une vidéo en cours repousse son bail
// (touch_generation) au moins toutes les 2 min : elle n'est jamais prise pour bloquée.
export const STALLED_AFTER_MS = 30 * 60_000;
export const STALLED = "STALLED";

export type PendingGeneration = { created_at: string; started_at: string | null };

export function isStalled(generation: PendingGeneration, now = Date.now()): boolean {
  const lastActivity = Math.max(Date.parse(generation.created_at), generation.started_at ? Date.parse(generation.started_at) : 0);
  return now - lastActivity > STALLED_AFTER_MS;
}
