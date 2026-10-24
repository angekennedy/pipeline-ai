import { describe, expect, it } from "vitest";
import { ANTHROPIC_MESSAGES_URL, anthropicSequence, jsonReplyStream } from "../../mocks/anthropic";
import { server } from "../../mocks/server";

const post = (body: unknown = {}) => fetch(ANTHROPIC_MESSAGES_URL, { method: "POST", body: JSON.stringify(body) });

const textOf = (sse: string) =>
  sse
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)))
    .filter((e) => e.delta?.type === "text_delta")
    .map((e) => e.delta.text)
    .join("");

describe("mock Anthropic", () => {
  it("refuse par défaut une requête sans fixture", async () => {
    expect((await post()).status).toBe(400);
  });

  it("streame une sortie structurée en deltas de texte reconstituables", async () => {
    const output = { title: "Le secret des pyramides" };
    const { handler } = anthropicSequence(() => jsonReplyStream(output, { chunkSize: 5 }));
    server.use(handler);
    const sse = await (await post()).text();
    expect(JSON.parse(textOf(sse))).toEqual(output);
    expect(sse).toContain('"stop_reason":"end_turn"');
  });

  it("enchaîne les réponses et enregistre chaque requête", async () => {
    const { handler, calls } = anthropicSequence(
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
