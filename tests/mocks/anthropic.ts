import { http, HttpResponse } from "msw/http";

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type ReplyOptions = {
  model?: string;
  usage?: Usage;
  stopReason?: "end_turn" | "max_tokens" | "refusal";
  stopDetails?: { type: "refusal"; category: string | null; explanation: string | null };
  chunkSize?: number;
};

const DEFAULT_USAGE: Usage = { input_tokens: 100, output_tokens: 200 };

const sse = (events: Array<[string, unknown]>) =>
  new HttpResponse(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });

// Réponse streamée d'une sortie structurée (`output_config.format`) : le JSON arrive en deltas de texte.
// Passer une chaîne pour simuler un texte brut (par exemple un JSON invalide).
export function jsonReplyStream(output: unknown, options: ReplyOptions = {}) {
  const { model = "claude-sonnet-5-5", usage = DEFAULT_USAGE, stopReason = "end_turn", stopDetails = null, chunkSize = 24 } = options;
  const text = typeof output === "string" ? output : JSON.stringify(output);

  const events: Array<[string, unknown]> = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          stop_details: null,
          usage: {
            input_tokens: usage.input_tokens,
            output_tokens: 0,
            cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
          },
        },
      },
    ],
  ];
  if (text) {
    events.push(["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: null } }]);
    for (let i = 0; i < text.length; i += chunkSize) {
      events.push(["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + chunkSize) } }]);
    }
    events.push(["content_block_stop", { type: "content_block_stop", index: 0 }]);
  }
  events.push(
    ["message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null, stop_details: stopDetails }, usage: { output_tokens: usage.output_tokens } }],
    ["message_stop", { type: "message_stop" }],
  );
  return sse(events);
}

export function refusalStream(category: string | null = "general_harms") {
  return jsonReplyStream("", {
    stopReason: "refusal",
    stopDetails: { type: "refusal", category, explanation: "Demande refusée par le classifieur" },
  });
}

export type RecordedCall = { body: Record<string, unknown>; headers: Headers };

// Répond successivement avec chaque réponse fournie (la dernière se répète) et enregistre les requêtes.
export function anthropicSequence(...replies: Array<() => Response>) {
  const calls: RecordedCall[] = [];
  const handler = http.post(ANTHROPIC_MESSAGES_URL, async ({ request }) => {
    calls.push({ body: (await request.json()) as Record<string, unknown>, headers: request.headers });
    return replies[Math.min(calls.length, replies.length) - 1]!();
  });
  return { handler, calls };
}

// Handler par défaut : échoue explicitement. Chaque test déclare sa réponse avec `server.use(...)`.
export const anthropicHandlers = [
  http.post(ANTHROPIC_MESSAGES_URL, () =>
    HttpResponse.json(
      { type: "error", error: { type: "invalid_request_error", message: "Aucune fixture Anthropic définie pour ce test" } },
      { status: 400 },
    ),
  ),
];
