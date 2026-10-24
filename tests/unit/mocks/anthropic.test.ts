import { http } from "msw/http";
import { describe, expect, it } from "vitest";
import { ANTHROPIC_MESSAGES_URL, toolUseMessage, toolUseStream } from "../../mocks/anthropic";
import { server } from "../../mocks/server";

const input = { variants: [{ title: "Le secret oublié des pyramides" }] };

describe("mock Anthropic", () => {
  it("refuse par défaut une requête sans fixture", async () => {
    const res = await fetch(ANTHROPIC_MESSAGES_URL, { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
  });

  it("renvoie un bloc tool_use", async () => {
    server.use(http.post(ANTHROPIC_MESSAGES_URL, () => Response.json(toolUseMessage({ toolName: "emit_titles", input }))));
    const body = await (await fetch(ANTHROPIC_MESSAGES_URL, { method: "POST", body: "{}" })).json();
    expect(body.content[0]).toMatchObject({ type: "tool_use", name: "emit_titles", input });
  });

  it("streame le JSON de l'outil en deltas reconstituables", async () => {
    server.use(http.post(ANTHROPIC_MESSAGES_URL, () => toolUseStream({ toolName: "emit_titles", input }, 8)));
    const text = await (await fetch(ANTHROPIC_MESSAGES_URL, { method: "POST", body: "{}" })).text();

    const partial = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)))
      .filter((e) => e.delta?.type === "input_json_delta")
      .map((e) => e.delta.partial_json)
      .join("");

    expect(JSON.parse(partial)).toEqual(input);
    expect(text).toContain("event: message_stop");
  });
});
