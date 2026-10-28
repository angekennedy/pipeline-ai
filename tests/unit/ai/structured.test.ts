import { http, HttpResponse } from "msw/http";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAIClient, OpenAIError } from "@/lib/ai/openai";
import type { PromptContext } from "@/lib/ai/prompts";
import { assetSchemas } from "@/lib/ai/schemas";
import { registry } from "@/lib/pipeline/registry";
import { validBrief, validScript, validTitles } from "../../fixtures/assets";
import {
  LlmRefusalError,
  LlmTruncatedError,
  LlmValidationError,
  callStructured,
  coerceEnums,
  jsonSchemaOf,
  unwrapRoot,
} from "@/lib/ai/structured";
import { OPENAI_CHAT_URL, openaiSequence, jsonReplyStream, refusalStream } from "../../mocks/openai";
import { server } from "../../mocks/server";

const client = new OpenAIClient({ apiKey: "test-key", maxRetries: 0 });

const Schema = z.object({
  title: z.string().min(10), // contrainte indicative dans le JSON Schema, appliquée par Zod
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
  const sequence = openaiSequence(...replies);
  server.use(sequence.handler);
  return sequence.calls;
}

describe("callStructured", () => {
  it("renvoie la sortie validée, l'usage et le coût", async () => {
    mock(() => jsonReplyStream(valid, { usage: { prompt_tokens: 1000, completion_tokens: 100, cached_tokens: 400 } }));
    const result = await callStructured(request(), { client });
    expect(result).toMatchObject({
      data: valid,
      model: "gpt-4o-2024-08-06",
      attempts: 1,
      repairs: 0,
      usage: { inputTokens: 600, outputTokens: 100, cacheReadTokens: 400, cacheCreationTokens: 0 },
      costUsdMicros: Math.round(600 * 2.5 + 400 * 1.25 + 100 * 10),
    });
  });

  it("envoie le système en premier message, le JSON Schema en sortie structurée et le streaming", async () => {
    const calls = mock(() => jsonReplyStream(valid));
    await callStructured(request(), { client });
    const body = calls[0]!.body as {
      model: string;
      max_completion_tokens: number;
      stream: boolean;
      stream_options: { include_usage: boolean };
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string; json_schema: { strict: boolean; schema: { $schema?: string; properties: { title: object } } } };
    };
    expect(body).toMatchObject({ model: "gpt-4o", max_completion_tokens: 1000, stream: true, stream_options: { include_usage: true } });
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(body.messages[0]!.content).toBe("Tu écris des scripts YouTube.");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(false);
    expect(body.response_format.json_schema.schema).not.toHaveProperty("$schema");
    expect(body.response_format.json_schema.schema.properties.title).toMatchObject({ type: "string" });
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer test-key");
  });

  it("retire les expressions régulières du JSON Schema envoyé, que Zod applique ensuite", async () => {
    const Hashtags = z.object({ hashtags: z.array(z.string().regex(/^#\p{L}[\p{L}\p{N}_]*$/u)).max(3) });
    const calls = mock(
      () => jsonReplyStream({ hashtags: ["sans-dièse"] }),
      () => jsonReplyStream({ hashtags: ["#ciel"] }),
    );
    const result = await callStructured(request({ schema: Hashtags }), { client });

    expect(JSON.stringify(calls[0]!.body.response_format)).not.toContain("pattern");
    expect(result).toMatchObject({ data: { hashtags: ["#ciel"] }, repairs: 1 });
  });

  it.each(Object.keys(assetSchemas) as Array<keyof typeof assetSchemas>)("n'envoie aucun pattern pour le schéma %s", (type) => {
    expect(JSON.stringify(jsonSchemaOf(assetSchemas[type]))).not.toMatch(/"pattern":/);
    const ctx = { brief: validBrief, channel: null, script: validScript, titles: validTitles } as PromptContext;
    const output = registry[type].outputSchema?.(ctx);
    if (output) expect(JSON.stringify(jsonSchemaOf(output))).not.toMatch(/"pattern":/);
  });

  it("ramène une valeur de liste mal écrite à la valeur autorisée, sans réparation", async () => {
    const Overlay = z.object({ placement: z.enum(["top-left", "bottom-right", "center"]), concepts: z.array(z.object({ font: z.enum(["bold-sans", "serif-impact"]) })) });
    mock(() => jsonReplyStream({ placement: "Top Left", concepts: [{ font: "bold_sans" }, { font: "Impact Serif" }] }));
    await expect(callStructured(request({ schema: Overlay }), { client })).resolves.toMatchObject({
      data: { placement: "top-left", concepts: [{ font: "bold-sans" }, { font: "serif-impact" }] },
      repairs: 0,
    });
  });

  it("laisse une valeur sans équivalent partir en réparation", async () => {
    const Overlay = z.object({ placement: z.enum(["top-left", "center"]) });
    const calls = mock(
      () => jsonReplyStream({ placement: "top-center" }),
      () => jsonReplyStream({ placement: "center" }),
    );
    await expect(callStructured(request({ schema: Overlay }), { client })).resolves.toMatchObject({ data: { placement: "center" }, repairs: 1 });
    expect(calls).toHaveLength(2);
  });

  it("ramène un nom de champ écrit autrement au nom attendu, sans écraser un champ présent", () => {
    const schema = { properties: { workingTitle: {}, callToAction: {} } };
    expect(coerceEnums(schema, { working_title: "A", "Call To Action": "B" })).toEqual({ workingTitle: "A", callToAction: "B" });
    expect(coerceEnums(schema, { workingTitle: "A", working_title: "doublon" })).toEqual({ workingTitle: "A", working_title: "doublon" });
  });

  it("suit les références $defs du JSON Schema", () => {
    const schema = { $defs: { pos: { enum: ["top-left", "center"] } }, properties: { a: { $ref: "#/$defs/pos" } } };
    expect(coerceEnums(schema, { a: "CENTER" })).toEqual({ a: "center" });
  });

  it("utilise gpt-4o-mini pour les livrables légers", async () => {
    const calls = mock(() => jsonReplyStream(valid, { model: "gpt-4o-mini-2024-07-18" }));
    const result = await callStructured(request({ modelKey: "light" }), { client });
    expect(calls[0]!.body.model).toBe("gpt-4o-mini");
    expect(result.costUsdMicros).toBe(Math.round(100 * 0.15 + 200 * 0.6));
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
    const retry = calls[1]!.body.messages as Array<{ role: string; content: string }>;
    expect(retry.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(retry[2]!.content).toBe(JSON.stringify({ title: "Court", tags: [] }));
    expect(retry[3]!.content).toContain("title");
  });

  it("répare aussi un JSON illisible", async () => {
    mock(
      () => jsonReplyStream('{"title": "Le secret'),
      () => jsonReplyStream(valid),
    );
    await expect(callStructured(request(), { client })).resolves.toMatchObject({ repairs: 1 });
  });

  it("reprend l'objet emballé dans une clé, encodé en chaîne, dans une liste ou sous le schéma recopié, sans réparation", async () => {
    for (const wrapped of [{ script: valid }, { output: { result: valid } }, JSON.stringify(JSON.stringify(valid)), [valid], { type: "object", properties: valid }]) {
      mock(() => jsonReplyStream(wrapped));
      await expect(callStructured(request(), { client })).resolves.toMatchObject({ data: valid, repairs: 0 });
    }
  });

  it("déballe le script complet renvoyé sous une clé « script »", async () => {
    const schema = jsonSchemaOf(assetSchemas.script);
    expect(unwrapRoot(schema, { script: validScript })).toEqual(validScript);
    // Une racine qui porte déjà un champ du script reste telle quelle (la validation dira ce qui manque).
    const partial = { workingTitle: "Titre", data: validScript };
    expect(unwrapRoot(schema, partial)).toBe(partial);
  });

  it("dit au modèle que l'objet manque à la racine, avec les clés reçues", async () => {
    const calls = mock(
      () => jsonReplyStream({ result: "ok", note: "voir plus bas" }),
      () => jsonReplyStream(valid),
    );
    await expect(callStructured(request(), { client })).resolves.toMatchObject({ data: valid, repairs: 1 });
    const repair = (calls[1]!.body.messages as Array<{ content: string }>).at(-1)!.content;
    expect(repair).toContain("Expected the requested JSON object itself at the root, with the keys title, tags; received an object with keys result, note.");
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
    const calls = mock(() => refusalStream("Je ne peux pas aider."));
    const error = await callStructured(request(), { client }).catch((e) => e);
    expect(error).toBeInstanceOf(LlmRefusalError);
    expect(error).toMatchObject({ code: "CONTENT_REFUSED", category: null, explanation: "Je ne peux pas aider.", retryable: false });
    expect(calls).toHaveLength(1);
  });

  it("compte le filtre de contenu comme un refus", async () => {
    mock(() => jsonReplyStream("", { finishReason: "content_filter" }));
    await expect(callStructured(request(), { client })).rejects.toMatchObject({ code: "CONTENT_REFUSED", category: "content_filter" });
  });

  it("renvoie un coût null si le modèle qui a répondu n'a pas de tarif connu", async () => {
    mock(() => jsonReplyStream(valid, { model: "gpt-inconnu" }));
    await expect(callStructured(request(), { client })).resolves.toMatchObject({ model: "gpt-inconnu", costUsdMicros: null });
  });

  it("relance une fois avec 1,5 fois plus de tokens si la sortie est tronquée", async () => {
    const calls = mock(
      () => jsonReplyStream('{"title": "Le sec', { finishReason: "length" }),
      () => jsonReplyStream(valid),
    );
    await expect(callStructured(request(), { client })).resolves.toMatchObject({ data: valid, attempts: 2 });
    expect(calls.map((c) => c.body.max_completion_tokens)).toEqual([1000, 1500]);
  });

  it("plafonne les tokens à la limite de sortie du modèle, sans relance inutile", async () => {
    const calls = mock(() => jsonReplyStream('{"title"', { finishReason: "length" }));
    const error = await callStructured(request({ maxTokens: 64_000 }), { client }).catch((e) => e);
    expect(error).toBeInstanceOf(LlmTruncatedError);
    expect(calls.map((c) => c.body.max_completion_tokens)).toEqual([16_384]);
  });

  it("échoue si la sortie reste tronquée", async () => {
    const calls = mock(() => jsonReplyStream('{"title"', { finishReason: "length" }));
    const error = await callStructured(request(), { client }).catch((e) => e);
    expect(error).toBeInstanceOf(LlmTruncatedError);
    expect(error).toMatchObject({ code: "MAX_TOKENS", retryable: false });
    expect(calls).toHaveLength(2);
  });

  it("laisse remonter les erreurs HTTP de l'API avec leur statut et leur message", async () => {
    server.use(
      http.post(OPENAI_CHAT_URL, () =>
        HttpResponse.json({ error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } }, { status: 429 }),
      ),
    );
    const error = await callStructured(request(), { client }).catch((e) => e);
    expect(error).toBeInstanceOf(OpenAIError);
    expect(error).toMatchObject({ status: 429, type: "insufficient_quota", message: "429 You exceeded your current quota" });
  });

  it("relance les erreurs passagères avant d'abandonner", async () => {
    let attempts = 0;
    server.use(
      http.post(OPENAI_CHAT_URL, () => {
        attempts++;
        return attempts === 1 ? HttpResponse.json({ error: { message: "overloaded" } }, { status: 503, headers: { "retry-after": "0.01" } }) : jsonReplyStream(valid);
      }),
    );
    const retrying = new OpenAIClient({ apiKey: "test-key", maxRetries: 1 });
    await expect(callStructured(request(), { client: retrying })).resolves.toMatchObject({ data: valid });
    expect(attempts).toBe(2);
  });
});
