import Anthropic from "@anthropic-ai/sdk";
import { http, HttpResponse } from "msw/http";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  LlmRefusalError,
  LlmTruncatedError,
  LlmValidationError,
  callStructured,
} from "@/lib/ai/structured";
import { ANTHROPIC_MESSAGES_URL, anthropicSequence, jsonReplyStream, refusalStream } from "../../mocks/anthropic";
import { server } from "../../mocks/server";

const client = new Anthropic({ apiKey: "test-key", maxRetries: 0 });

const Schema = z.object({
  title: z.string().min(10), // contrainte retirée du JSON Schema par le SDK, revalidée par Zod
  tags: z.array(z.string()).max(2),
});
const valid = { title: "Le secret des pyramides", tags: ["histoire"] };

const request = (overrides: Partial<Parameters<typeof callStructured>[0]> = {}) => ({
  modelKey: "script.standard" as const,
  system: "Tu écris des scripts YouTube.",
  messages: [{ role: "user" as const, content: "Produis l'asset." }],
  schema: Schema,
  maxTokens: 1000,
  ...overrides,
});

function mock(...replies: Array<() => Response>) {
  const sequence = anthropicSequence(...replies);
  server.use(sequence.handler);
  return sequence.calls;
}

describe("callStructured", () => {
  it("renvoie la sortie validée, l'usage et le coût", async () => {
    mock(() => jsonReplyStream(valid, { usage: { input_tokens: 1000, output_tokens: 100 } }));
    const result = await callStructured(request(), { client });
    expect(result).toMatchObject({
      data: valid,
      model: "claude-sonnet-5-5",
      attempts: 1,
      repairs: 0,
      usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 },
      costUsdMicros: 1000 * 2 + 100 * 10,
    });
  });

  it("envoie le JSON Schema en sortie structurée, l'effort et le streaming", async () => {
    const calls = mock(() => jsonReplyStream(valid));
    await callStructured(request(), { client });
    const body = calls[0]!.body as {
      model: string;
      max_tokens: number;
      stream: boolean;
      tool_choice?: unknown;
      output_config: { effort: string; format: { type: string; schema: { additionalProperties: boolean; properties: { title: object } } } };
    };
    expect(body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 1000, stream: true });
    expect(body.tool_choice).toBeUndefined(); // le tool use forcé renvoie 400 sur Opus et Sonnet 5.5
    expect(body.output_config.effort).toBe("medium");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.additionalProperties).toBe(false);
    expect(body.output_config.format.schema.properties.title).not.toHaveProperty("minLength");
  });

  it("active le repli serveur sur refus pour Sonnet, pas pour Haiku", async () => {
    const calls = mock(() => jsonReplyStream(valid));
    await callStructured(request(), { client });
    await callStructured(request({ modelKey: "light" }), { client });

    expect(calls[0]!.body.fallbacks).toBe("default");
    expect(calls[0]!.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(calls[1]!.body).not.toHaveProperty("fallbacks");
    expect(calls[1]!.headers.get("anthropic-beta") ?? "").not.toContain("server-side-fallback");
  });

  it("transmet le texte au fil du stream", async () => {
    mock(() => jsonReplyStream(valid, { chunkSize: 4 }));
    const onText = vi.fn();
    await callStructured(request({ onText }), { client });
    expect(onText.mock.calls.length).toBeGreaterThan(3);
    expect(JSON.parse(onText.mock.lastCall![1])).toEqual(valid);
  });

  it("répare une sortie invalide en renvoyant les erreurs Zod au modèle", async () => {
    const calls = mock(
      () => jsonReplyStream({ title: "Court", tags: [] }),
      () => jsonReplyStream(valid),
    );
    const result = await callStructured(request(), { client });

    expect(result).toMatchObject({ data: valid, attempts: 2, repairs: 1 });
    expect(result.usage.inputTokens).toBe(200); // usage cumulé sur les deux appels
    const retry = calls[1]!.body.messages as Array<{ role: string; content: unknown }>;
    expect(retry.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(retry[2]!.content)).toContain("title");
  });

  it("répare aussi un JSON illisible", async () => {
    mock(
      () => jsonReplyStream('{"title": "Le secret'),
      () => jsonReplyStream(valid),
    );
    await expect(callStructured(request(), { client })).resolves.toMatchObject({ repairs: 1 });
  });

  it("échoue après une seule réparation infructueuse", async () => {
    const calls = mock(() => jsonReplyStream({ title: "Court", tags: [] }));
    const error = await callStructured(request(), { client }).catch((e) => e);
    expect(error).toBeInstanceOf(LlmValidationError);
    expect(error).toMatchObject({ code: "SCHEMA_INVALID", retryable: false });
    expect(error.issues[0].path).toEqual(["title"]);
    expect(calls).toHaveLength(2);
  });

  it("lève une erreur de refus sans relancer", async () => {
    const calls = mock(() => refusalStream("cyber"));
    const error = await callStructured(request(), { client }).catch((e) => e);
    expect(error).toBeInstanceOf(LlmRefusalError);
    expect(error).toMatchObject({ code: "CONTENT_REFUSED", category: "cyber", retryable: false });
    expect(calls).toHaveLength(1);
  });

  it("accepte un refus sans catégorie", async () => {
    mock(() => refusalStream(null));
    await expect(callStructured(request(), { client })).rejects.toMatchObject({ code: "CONTENT_REFUSED", category: null });
  });

  it("renvoie un coût null si le modèle qui a répondu n'a pas de tarif connu", async () => {
    mock(() => jsonReplyStream(valid, { model: "claude-inconnu" }));
    await expect(callStructured(request(), { client })).resolves.toMatchObject({ model: "claude-inconnu", costUsdMicros: null });
  });

  it("relance une fois avec 1,5 fois plus de tokens si la sortie est tronquée", async () => {
    const calls = mock(
      () => jsonReplyStream('{"title": "Le sec', { stopReason: "max_tokens" }),
      () => jsonReplyStream(valid),
    );
    await expect(callStructured(request(), { client })).resolves.toMatchObject({ data: valid, attempts: 2 });
    expect(calls.map((c) => c.body.max_tokens)).toEqual([1000, 1500]);
  });

  it("échoue si la sortie reste tronquée", async () => {
    const calls = mock(() => jsonReplyStream('{"title"', { stopReason: "max_tokens" }));
    const error = await callStructured(request(), { client }).catch((e) => e);
    expect(error).toBeInstanceOf(LlmTruncatedError);
    expect(error).toMatchObject({ code: "MAX_TOKENS", retryable: false });
    expect(calls).toHaveLength(2);
  });

  it("laisse remonter les erreurs HTTP typées du SDK", async () => {
    server.use(
      http.post(ANTHROPIC_MESSAGES_URL, () =>
        HttpResponse.json({ type: "error", error: { type: "invalid_request_error", message: "bad" } }, { status: 400 }),
      ),
    );
    await expect(callStructured(request(), { client })).rejects.toBeInstanceOf(Anthropic.BadRequestError);
  });
});
