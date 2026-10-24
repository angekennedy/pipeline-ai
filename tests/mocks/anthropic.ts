import { http, HttpResponse } from "msw/http";

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

type ToolUseFixture = {
  model?: string;
  toolName: string;
  input: unknown;
  usage?: { input_tokens: number; output_tokens: number };
};

const DEFAULT_USAGE = { input_tokens: 100, output_tokens: 200 };

// Réponse non streamée : un unique bloc tool_use, comme avec un tool_choice forcé.
export function toolUseMessage({ model = "claude-haiku-5-5", toolName, input, usage = DEFAULT_USAGE }: ToolUseFixture) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "tool_use", id: "toolu_test", name: toolName, input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage,
  };
}

// Réponse streamée (SSE) : le JSON de l'outil est découpé en deltas `input_json_delta`.
export function toolUseStream({ model = "claude-sonnet-5-5", toolName, input, usage = DEFAULT_USAGE }: ToolUseFixture, chunkSize = 24) {
  const json = JSON.stringify(input);
  const events: Array<[string, unknown]> = [
    ["message_start", { type: "message_start", message: { ...toolUseMessage({ model, toolName, input: {}, usage: { input_tokens: usage.input_tokens, output_tokens: 0 } }), content: [], stop_reason: null } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_test", name: toolName, input: {} } }],
  ];
  for (let i = 0; i < json.length; i += chunkSize) {
    events.push(["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json.slice(i, i + chunkSize) } }]);
  }
  events.push(
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: usage.output_tokens } }],
    ["message_stop", { type: "message_stop" }],
  );

  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new HttpResponse(body, { headers: { "content-type": "text/event-stream" } });
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
