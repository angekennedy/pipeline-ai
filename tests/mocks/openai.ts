import { http, HttpResponse } from "msw/http";

export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

type Usage = { prompt_tokens: number; completion_tokens: number; cached_tokens?: number };

type ReplyOptions = {
  model?: string;
  usage?: Usage;
  finishReason?: "stop" | "length" | "content_filter";
  refusal?: string;
  chunkSize?: number;
};

const DEFAULT_USAGE: Usage = { prompt_tokens: 100, completion_tokens: 200 };

const sse = (chunks: unknown[]) =>
  new HttpResponse([...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), "data: [DONE]\n\n"].join(""), {
    headers: { "content-type": "text/event-stream" },
  });

// Réponse streamée d'une sortie structurée (`response_format: json_schema`) : le JSON arrive en deltas
// de contenu, l'usage dans un dernier fragment sans choix. Passer une chaîne pour simuler un texte
// brut (par exemple un JSON invalide).
export function jsonReplyStream(output: unknown, options: ReplyOptions = {}) {
  const { model = "gpt-4o-2024-08-06", usage = DEFAULT_USAGE, finishReason = "stop", refusal, chunkSize = 24 } = options;
  const text = typeof output === "string" ? output : JSON.stringify(output);
  const base = { id: "chatcmpl-test", object: "chat.completion.chunk", created: 0, model };

  const chunks: unknown[] = [{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }], usage: null }];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push({ ...base, choices: [{ index: 0, delta: { content: text.slice(i, i + chunkSize) }, finish_reason: null }], usage: null });
  }
  if (refusal) chunks.push({ ...base, choices: [{ index: 0, delta: { refusal }, finish_reason: null }], usage: null });
  chunks.push(
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: null },
    {
      ...base,
      choices: [],
      usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.prompt_tokens + usage.completion_tokens,
        prompt_tokens_details: { cached_tokens: usage.cached_tokens ?? 0 },
      },
    },
  );
  return sse(chunks);
}

// Refus du modèle en sortie structurée : un champ `refusal` au lieu du contenu.
export function refusalStream(refusal = "I can't help with that.") {
  return jsonReplyStream("", { refusal });
}

export type RecordedCall = { body: Record<string, unknown>; headers: Headers };

// Répond successivement avec chaque réponse fournie (la dernière se répète) et enregistre les requêtes.
export function openaiSequence(...replies: Array<() => Response>) {
  const calls: RecordedCall[] = [];
  const handler = http.post(OPENAI_CHAT_URL, async ({ request }) => {
    calls.push({ body: (await request.json()) as Record<string, unknown>, headers: request.headers });
    return replies[Math.min(calls.length, replies.length) - 1]!();
  });
  return { handler, calls };
}

// Handler par défaut : échoue explicitement. Chaque test déclare sa réponse avec `server.use(...)`.
export const openaiHandlers = [
  http.post(OPENAI_CHAT_URL, () =>
    HttpResponse.json({ error: { message: "Aucune fixture OpenAI définie pour ce test", type: "invalid_request_error", code: null } }, { status: 400 }),
  ),
];
