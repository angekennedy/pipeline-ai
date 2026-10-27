// Client minimal de l'API OpenAI (Chat Completions en streaming), en `fetch` : pas de SDK à
// installer. Couvre ce dont callStructured a besoin : relances sur les erreurs passagères, délai
// maximal, lecture du flux SSE, usage final (`stream_options.include_usage`).
import { requestWithRetry } from "@/lib/http";

const BASE_URL = "https://api.openai.com/v1";

// Limite de sortie de gpt-4o et gpt-4o-mini : au-delà, l'API renvoie une 400.
export const MAX_OUTPUT_TOKENS = 16_384;

// Erreur HTTP de l'API : `status` 0 pour une erreur réseau ou un délai dépassé.
export class OpenAIError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type: string | null = null,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "OpenAIError";
  }
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  max_completion_tokens: number;
  response_format: { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict: boolean } };
};

export type ChatUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
};

export type ChatResult = {
  model: string;
  text: string;
  refusal: string | null;
  finishReason: string | null; // stop, length, content_filter
  usage: ChatUsage;
};

// Taille en `LARGEURxHAUTEUR` : multiples de 16, ratio entre 1:3 et 3:1 (1536x864 pour du 16:9).
export type ImageRequest = {
  model: string;
  prompt: string;
  size: `${number}x${number}`;
  quality: "low" | "medium" | "high";
  output_format: "jpeg" | "png" | "webp";
  output_compression?: number;
};

export type ImageUsage = { input_tokens: number; output_tokens: number };
export type ImageResult = { bytes: Uint8Array; usage: ImageUsage | null };

type ChunkEvent = {
  model?: string;
  choices?: Array<{ delta?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }>;
  usage?: ChatUsage | null;
  error?: { message?: string; type?: string; code?: string };
};

export type OpenAIClientOptions = {
  apiKey: string;
  baseURL?: string;
  maxRetries?: number;
  timeout?: number;
  fetch?: typeof fetch;
};


export class OpenAIClient {
  readonly maxRetries: number;
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly timeout: number;
  private readonly fetchImpl: typeof fetch;

  constructor({ apiKey, baseURL = BASE_URL, maxRetries = 2, timeout = 10 * 60 * 1000, fetch: fetchImpl }: OpenAIClientOptions) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.maxRetries = maxRetries;
    this.timeout = timeout;
    // Résolu à l'appel : les tests remplacent `fetch` global (msw) après la création du client.
    this.fetchImpl = fetchImpl ?? ((...args) => fetch(...args));
  }

  // Une image par appel, renvoyée en base64 par l'API (jamais d'URL avec les modèles GPT Image).
  async generateImage(body: ImageRequest, { signal }: { signal?: AbortSignal } = {}): Promise<ImageResult> {
    const response = await this.post("/images/generations", { ...body, n: 1 }, signal);
    const json = (await response.json()) as { data?: Array<{ b64_json?: string }>; usage?: ImageUsage };
    const encoded = json.data?.[0]?.b64_json;
    if (!encoded) throw new OpenAIError(response.status, "Réponse d'image sans contenu");
    return { bytes: new Uint8Array(Buffer.from(encoded, "base64")), usage: json.usage ?? null };
  }

  async streamChat(
    body: ChatRequest,
    { signal, onText }: { signal?: AbortSignal; onText?: (delta: string, snapshot: string) => void } = {},
  ): Promise<ChatResult> {
    const response = await this.post("/chat/completions", { ...body, stream: true, stream_options: { include_usage: true } }, signal);
    return readStream(response, onText);
  }

  private post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    return requestWithRetry(
      `${this.baseURL}${path}`,
      { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify(body) },
      {
        maxRetries: this.maxRetries,
        timeout: this.timeout,
        fetch: this.fetchImpl,
        signal,
        toError: errorOf,
        networkError: (error) => new OpenAIError(0, `Requête OpenAI impossible : ${error instanceof Error ? error.message : String(error)}`),
      },
    );
  }
}

async function errorOf(response: Response): Promise<OpenAIError> {
  const text = await response.text().catch(() => "");
  try {
    const { error } = JSON.parse(text) as { error?: { message?: string; type?: string; code?: string } };
    if (error?.message) return new OpenAIError(response.status, `${response.status} ${error.message}`, error.type ?? null, error.code ?? null);
  } catch {
    // Corps non JSON : on garde le texte brut.
  }
  return new OpenAIError(response.status, `${response.status} ${text.slice(0, 200) || response.statusText}`);
}

async function readStream(response: Response, onText?: (delta: string, snapshot: string) => void): Promise<ChatResult> {
  if (!response.body) throw new OpenAIError(response.status, "Réponse OpenAI sans corps");
  const result: ChatResult = { model: "", text: "", refusal: null, finishReason: null, usage: { prompt_tokens: 0, completion_tokens: 0 } };
  const decoder = new TextDecoder();
  let buffer = "";

  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const chunk = JSON.parse(data) as ChunkEvent;
    if (chunk.error) throw new OpenAIError(500, chunk.error.message ?? "Erreur dans le flux OpenAI", chunk.error.type ?? null, chunk.error.code ?? null);
    if (chunk.model) result.model = chunk.model;
    if (chunk.usage) result.usage = chunk.usage;
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta?.content;
      if (delta) {
        result.text += delta;
        onText?.(delta, result.text);
      }
      if (choice.delta?.refusal) result.refusal = (result.refusal ?? "") + choice.delta.refusal;
      if (choice.finish_reason) result.finishReason = choice.finish_reason;
    }
  };

  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) handle(line);
  }
  handle(buffer + decoder.decode());
  return result;
}
