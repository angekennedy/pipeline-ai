import Anthropic from "@anthropic-ai/sdk";
import { HttpResponse, http } from "msw/http";
import { describe, expect, it } from "vitest";
import { runChecks } from "../../../evals/lib/checks";
import { runCase } from "../../../evals/lib/run-case";
import type { Brief } from "@/lib/ai/schemas";
import { ANTHROPIC_MESSAGES_URL, jsonReplyStream, refusalStream } from "../../mocks/anthropic";
import { server } from "../../mocks/server";
import { validBrief, validScript, validSeo, validThumbnails, validTitles, validVoiceover } from "../../fixtures/assets";

const client = new Anthropic({ apiKey: "test-key", maxRetries: 0 });
const voiceover = { ...validVoiceover, segments: [1, 2, 3, 4].map((sceneIndex) => ({ ...validVoiceover.segments[0]!, sceneIndex })) };

// Réponse par asset, reconnu au rôle annoncé dans son prompt système.
function mockApi(script: () => Response = () => jsonReplyStream(validScript)) {
  const replies: Array<[string, () => Response]> = [
    ["scriptwriter", script],
    ["packaging strategist", () => jsonReplyStream(validTitles, { model: "claude-haiku-5-5" })],
    ["SEO specialist", () => jsonReplyStream(validSeo, { model: "claude-haiku-5-5" })],
    ["voice director", () => jsonReplyStream(voiceover, { model: "claude-haiku-5-5" })],
    ["thumbnail art director", () => jsonReplyStream(validThumbnails, { model: "claude-haiku-5-5" })],
  ];
  server.use(
    http.post(ANTHROPIC_MESSAGES_URL, async ({ request }) => {
      const system = ((await request.json()) as { system: Array<{ text: string }> }).system[0]!.text;
      return replies.find(([role]) => system.includes(role))![1]();
    }),
  );
}

describe("runCase", () => {
  it("exécute le pipeline réel et renvoie sorties, transcription et télémétrie par asset", async () => {
    mockApi();
    const run = await runCase(validBrief as Brief, "standard", { client });

    expect(Object.keys(run.output.assets).filter((type) => run.output.assets[type as keyof typeof run.output.assets])).toHaveLength(5);
    expect(run.output.failures).toEqual({});
    expect(run.assets.script).toMatchObject({ expectedModel: "claude-sonnet-5-5", model: "claude-sonnet-5-5", inputTokens: 100, failure: null });
    expect(run.assets.titles).toMatchObject({ expectedModel: "claude-haiku-5-5", model: "claude-haiku-5-5" });
    expect(run.assets.script.costUsdMicros).toBeGreaterThan(0);
    // Pour chaque asset : prompt système, message utilisateur, sortie.
    expect(run.trace.map((turn) => turn.role)).toEqual(Array(5).fill(["system", "user", "assistant"]).flat());
    expect(run.trace[0]!.content).toContain("[script]");
    expect(run.latencyS).toBeGreaterThanOrEqual(0);
    expect(runChecks(run.output).grade.complete).toBe(1);
  });

  it("premium : le script est demandé à Opus", async () => {
    mockApi(() => jsonReplyStream(validScript, { model: "claude-opus-5-5" }));
    const run = await runCase(validBrief as Brief, "premium", { client });
    expect(run.assets.script).toMatchObject({ expectedModel: "claude-opus-5-5", model: "claude-opus-5-5" });
  });

  it("script refusé : échec enregistré, dérivés sautés, coût du refus compté", async () => {
    mockApi(() => refusalStream("cyber"));
    const run = await runCase(validBrief as Brief, "standard", { client });

    expect(run.output.failures).toEqual({ script: "CONTENT_REFUSED", titles: "SKIPPED", seo: "SKIPPED", voiceover: "SKIPPED", thumbnails: "SKIPPED" });
    expect(run.assets.script.costUsdMicros).toBeGreaterThan(0);
    // La transcription garde le prompt envoyé : utile pour comprendre un refus.
    expect(run.trace.map((turn) => turn.role)).toEqual(["system", "user", "assistant"]);
    expect(run.trace[2]!.content).toBe("Échec : CONTENT_REFUSED");
  });

  it("garde le message d'une erreur d'API, pour la classer en erreur d'infrastructure et non en note", async () => {
    mockApi(() => HttpResponse.json({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low" } }, { status: 400 }));
    const run = await runCase(validBrief as Brief, "standard", { client });
    expect(run.assets.script).toMatchObject({ failure: "PROVIDER_ERROR", failureMessage: expect.stringContaining("credit balance is too low"), costUsdMicros: 0 });
  });
});
