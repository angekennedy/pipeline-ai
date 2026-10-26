import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Rate limits (ARCHITECTURE §6), en fenêtre glissante dans Postgres (migration 0013). Une demande
// passe tous ses compteurs ensemble, ou n'est comptée dans aucun.

const HOUR = 3600;

export const RATE_LIMITS = {
  pipelineUser: { limit: 10, window: HOUR },
  pipelineWorkspace: { limit: 30, window: HOUR },
  regenerateUser: { limit: 30, window: HOUR },
  loginIp: { limit: 5, window: 15 * 60 },
  loginEmail: { limit: 5, window: 15 * 60 },
  exportUser: { limit: 60, window: HOUR },
} as const satisfies Record<string, { limit: number; window: number }>;

export type RateLimitRule = keyof typeof RATE_LIMITS;

// Au-delà de la limite : l'action renvoie ce délai au formulaire, la route un 429 avec Retry-After.
export class RateLimitedError extends Error {
  readonly code = "RATE_LIMITED";
  constructor(readonly retryAfterSeconds: number) {
    super(`Limite atteinte : réessayer dans ${retryAfterSeconds} s`);
    this.name = "RateLimitedError";
  }
}

// Un e-mail ou une IP ne sont jamais stockés en clair : seulement leur empreinte.
export const fingerprint = (value: string) => createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32);

export type RateLimitHit = { rule: RateLimitRule; subject: string };

export async function enforceRateLimit(db: SupabaseClient<Database>, hits: RateLimitHit[]): Promise<void> {
  const { data, error } = await db.rpc("rate_limit_hit", {
    p_buckets: hits.map(({ rule, subject }) => `${rule}:${subject}`),
    p_limits: hits.map(({ rule }) => RATE_LIMITS[rule].limit),
    p_windows: hits.map(({ rule }) => RATE_LIMITS[rule].window),
  });
  if (error) throw Object.assign(new Error(`Rate limit : ${error.message}`), { code: error.code });
  if (data > 0) throw new RateLimitedError(data);
}

// Horodatages de plus d'un jour (la plus longue fenêtre) : renvoie le nombre de lignes purgées.
export async function purgeRateLimits(db: SupabaseClient<Database>): Promise<number> {
  const { data, error } = await db.rpc("purge_rate_limits");
  if (error) throw Object.assign(new Error(`Purge des rate limits : ${error.message}`), { code: error.code });
  return data;
}

// Minutes affichées à l'utilisateur, arrondies au-dessus : « dans 1 minute » plutôt que « dans 0 ».
export const retryMinutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));
