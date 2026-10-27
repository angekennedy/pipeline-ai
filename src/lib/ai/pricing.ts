// Tarifs de l'API OpenAI en USD par million de tokens (à revérifier sur
// https://openai.com/api/pricing avant chaque calibrage des crédits). Les tokens d'entrée lus en
// cache (préfixe identique de 1 024 tokens et plus, automatique) sont facturés au tarif `cacheRead`.
type Price = { input: number; output: number; cacheRead: number };

export const PRICING: Record<string, Price> = {
  "gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075 },
};

// Images, en USD par million de tokens : texte du prompt en entrée, image en sortie. La taille et la
// qualité changent le nombre de tokens de sortie, renvoyé dans `usage`.
const IMAGE_PRICING: Record<string, { textInput: number; imageOutput: number }> = {
  "gpt-image-2": { textInput: 5, imageOutput: 30 },
  "gpt-image-2.5-flare": { textInput: 5, imageOutput: 30 },
  "gpt-image-2.5-sunburst": { textInput: 5, imageOutput: 30 },
  "gpt-image-1.5": { textInput: 5, imageOutput: 32 },
  "gpt-image-1-mini": { textInput: 2, imageOutput: 8 },
};

export function imageCostUsdMicros(model: string, usage: { input_tokens: number; output_tokens: number } | null | undefined): number | null {
  const price = IMAGE_PRICING[baseModel(model)];
  if (!price || !usage) return null;
  return Math.round(usage.input_tokens * price.textInput + usage.output_tokens * price.imageOutput);
}

// Voix ElevenLabs (facturée au caractère envoyé) et rendu Shotstack (à la minute rendue), au tarif
// sans engagement d'octobre 2026 : à revérifier sur elevenlabs.io/pricing/api et shotstack.io/pricing.
export const VOICE_USD_MICROS_PER_CHARACTER = 80; // 0,08 $ pour 1 000 caractères
export const RENDER_USD_MICROS_PER_SECOND = Math.round(200_000 / 60); // 0,20 $ la minute

// L'API répond avec l'instantané daté du modèle demandé (gpt-4o → gpt-4o-2024-08-06).
export const baseModel = (model: string) => model.replace(/-\d{4}-\d{2}-\d{2}$/, "");

// Usage tel que renvoyé par l'API : `cached_tokens` est inclus dans `prompt_tokens`.
export type TokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
};

// 1 token facturé 1 $/MTok coûte exactement 1 micro-dollar. Le modèle peut être un instantané daté.
export function costUsdMicros(model: string, usage: TokenUsage): number | null {
  const price = PRICING[baseModel(model)];
  if (!price) return null;

  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return Math.round((usage.prompt_tokens - cached) * price.input + cached * price.cacheRead + usage.completion_tokens * price.output);
}
