// Appels HTTP aux API des fournisseurs (OpenAI, ElevenLabs, Shotstack), en `fetch` : relances sur
// les erreurs passagères avec backoff, délai maximal, `retry-after` respecté. Le corps d'une réponse
// en erreur est transformé par `toError`, propre à chaque fournisseur.

const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

export type RetryOptions = {
  maxRetries: number;
  timeout: number; // ms, par tentative
  fetch: typeof fetch;
  signal?: AbortSignal;
  toError: (response: Response) => Promise<Error>;
  networkError: (cause: unknown) => Error; // aucune réponse après la dernière tentative
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 0,5 s, 1 s, 2 s… avec jitter, plafonné à 8 s.
const backoff = (attempt: number) => Math.min(8000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.25);

function retryAfter(response: Response): number | null {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 60 ? seconds * 1000 : null;
}

export async function requestWithRetry(url: string, init: RequestInit, options: RetryOptions): Promise<Response> {
  const { signal } = options;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await options.fetch(url, {
        ...init,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(options.timeout)]) : AbortSignal.timeout(options.timeout),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (attempt < options.maxRetries) {
        await sleep(backoff(attempt));
        continue;
      }
      throw options.networkError(error);
    }
    if (response.ok) return response;
    if (RETRYABLE_STATUSES.has(response.status) && attempt < options.maxRetries) {
      await response.body?.cancel();
      await sleep(retryAfter(response) ?? backoff(attempt));
      continue;
    }
    throw await options.toError(response);
  }
}
