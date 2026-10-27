import { describe, expect, it } from "vitest";
import { OPENAI_CHAT_URL, openaiSequence, jsonReplyStream } from "../../mocks/openai";
import { server } from "../../mocks/server";

const post = (body: unknown = {}) => fetch(OPENAI_CHAT_URL, { method: "POST", body: JSON.stringify(body) });

const textOf = (sse: string) =>
  sse
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)))
    .flatMap((e) => e.choices ?? [])
    .map((choice) => choice.delta?.content ?? "")
    .join("");

describe("mock OpenAI", () => {
  it("refuse par défaut une requête sans fixture", async () => {
    expect((await post()).status).toBe(400);
  });

  it("streame une sortie structurée en deltas de texte reconstituables", async () => {
    const output = { title: "Le secret des pyramides" };
    const { handler } = openaiSequence(() => jsonReplyStream(output, { chunkSize: 5 }));
    server.use(handler);
    const sse = await (await post()).text();
    expect(JSON.parse(textOf(sse))).toEqual(output);
    expect(sse).toContain('"finish_reason":"stop"');
    expect(sse.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("enchaîne les réponses et enregistre chaque requête", async () => {
    const { handler, calls } = openaiSequence(
      () => jsonReplyStream("premier"),
      () => jsonReplyStream("suivant"),
    );
    server.use(handler);
    const texts = [];
    for (const n of [1, 2, 3]) texts.push(textOf(await (await post({ n })).text()));
    expect(texts).toEqual(["premier", "suivant", "suivant"]);
    expect(calls.map((c) => c.body.n)).toEqual([1, 2, 3]);
  });
});
