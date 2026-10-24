// Tarifs de l'API Claude en USD par million de tokens (grille de octobre 2026, à revérifier
// sur https://platform.claude.com/docs/en/about-claude/pricing avant chaque calibrage des crédits).
// Haiku 5.5 : tarif valable jusqu'à 100K tokens de prompt, au-delà desquels il passe à 0,50 / 2,50 $.
// Nos prompts restent bien en dessous.
type Price = { input: number; output: number; cacheRead: number };

export const PRICING: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  // Modèles vers lesquels `fallbacks: "default"` peut rediriger une requête refusée.
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
};

// Écriture en cache : ×1,25 du tarif d'entrée pour un TTL de 5 min, ×2 pour 1 h.
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null;
};

// 1 token facturé 1 $/MTok coûte exactement 1 micro-dollar.
export function costUsdMicros(model: string, usage: TokenUsage): number | null {
  const price = PRICING[model];
  if (!price) return null;

  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? usage.cache_creation_input_tokens ?? 0;

  return Math.round(
    usage.input_tokens * price.input +
      usage.output_tokens * price.output +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
      write5m * price.input * CACHE_WRITE_5M +
      write1h * price.input * CACHE_WRITE_1H,
  );
}

type IterationUsage = TokenUsage & { model?: string | null };

// Quand l'API a enchaîné plusieurs modèles (refus puis repli), chaque itération est facturée
// au tarif du modèle qui l'a produite.
export function messageCostUsdMicros(message: {
  model: string;
  usage: TokenUsage & { iterations?: IterationUsage[] | null };
}): number | null {
  const iterations = message.usage.iterations;
  if (!iterations?.length) return costUsdMicros(message.model, message.usage);

  let total = 0;
  for (const iteration of iterations) {
    const cost = costUsdMicros(iteration.model ?? message.model, iteration);
    if (cost === null) return null;
    total += cost;
  }
  return total;
}
