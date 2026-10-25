import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSceneThrottle, safePublish } from "@/lib/realtime/broadcast";
import { PipelineEventSchema, pipelineTopic, type PipelineEvent } from "@/lib/realtime/events";
import { validScript } from "../../fixtures/assets";

const json = JSON.stringify(validScript);
const sceneEnd = (n: number) => json.indexOf(`"index":${n + 1}`); // texte jusqu'à la fin de la scène n (n < 4)

function streamer() {
  const sent: PipelineEvent[] = [];
  const publish = vi.fn(async (event: PipelineEvent) => {
    sent.push(event);
  });
  const throttle = createSceneThrottle(publish);
  let snapshot = "";
  const feed = (upTo: number) => {
    const delta = json.slice(snapshot.length, upTo);
    snapshot += delta;
    throttle.onText(delta, snapshot);
  };
  const indexes = () => sent.map((event) => (event.type === "asset.partial" ? event.scenes.map((s) => s.index) : []));
  return { throttle, publish, feed, indexes };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createSceneThrottle", () => {
  it("envoie la première scène complète tout de suite, et seulement une fois complète", () => {
    const { feed, indexes } = streamer();
    feed(sceneEnd(1) - 20);
    expect(indexes()).toEqual([]);
    feed(sceneEnd(1));
    expect(indexes()).toEqual([[1]]);
  });

  it("regroupe les scènes terminées pendant l'intervalle en un seul envoi", () => {
    const { feed, indexes } = streamer();
    feed(sceneEnd(1));
    vi.advanceTimersByTime(100);
    feed(sceneEnd(2));
    feed(sceneEnd(3));
    expect(indexes()).toEqual([[1]]);
    vi.advanceTimersByTime(150);
    expect(indexes()).toEqual([[1], [2, 3]]);
  });

  it("n'envoie pas plus de 4 messages par seconde", () => {
    const { feed, publish } = streamer();
    // Un delta toutes les 10 ms, de quoi terminer une scène bien plus souvent que toutes les 250 ms.
    for (let at = 0; at <= json.length; at += 5) {
      feed(Math.min(at, json.length));
      vi.advanceTimersByTime(10);
    }
    const elapsedSeconds = Math.ceil(((json.length / 5) * 10) / 1000);
    expect(publish.mock.calls.length).toBeLessThanOrEqual(4 * elapsedSeconds);
  });

  it("flush envoie aussitôt les scènes en attente et attend l'envoi", async () => {
    const { feed, throttle, indexes } = streamer();
    feed(sceneEnd(1));
    feed(json.length);
    await throttle.flush();
    expect(indexes()).toEqual([[1], [2, 3, 4]]);
    vi.advanceTimersByTime(1000);
    expect(indexes()).toHaveLength(2); // le minuteur a été annulé
  });

  it("cancel abandonne les scènes en attente (génération en échec)", () => {
    const { feed, throttle, indexes } = streamer();
    feed(sceneEnd(1));
    feed(json.length);
    throttle.cancel();
    vi.advanceTimersByTime(1000);
    expect(indexes()).toEqual([[1]]);
  });

  it("repart de zéro sur un nouveau stream (réparation, relance) et renvoie les scènes", async () => {
    const { throttle, indexes } = streamer();
    throttle.onText(json, json);
    vi.advanceTimersByTime(300);
    throttle.onText(json, json); // premier delta d'un nouveau message : delta = snapshot
    await throttle.flush();
    expect(indexes()).toEqual([
      [1, 2, 3, 4],
      [1, 2, 3, 4],
    ]);
  });

  it("produit des événements conformes au schéma partagé", () => {
    const { feed, publish } = streamer();
    feed(sceneEnd(1));
    expect(PipelineEventSchema.parse(publish.mock.calls[0]![0])).toMatchObject({ type: "asset.partial", asset: "script" });
  });
});

describe("safePublish", () => {
  it("n'interrompt jamais la génération si l'envoi échoue", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(safePublish(async () => Promise.reject(new Error("réseau")), { type: "asset.started", asset: "seo" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("asset.started"), expect.any(Error));
    warn.mockRestore();
  });

  it("ne fait rien sans éditeur", async () => {
    await expect(safePublish(undefined, { type: "asset.started", asset: "seo" })).resolves.toBeUndefined();
  });
});

describe("événements", () => {
  it("nomme le canal d'un pipeline", () => {
    expect(pipelineTopic("abc")).toBe("pipeline:abc");
  });

  it.each([
    { type: "asset.started", asset: "script" },
    { type: "asset.completed", asset: "titles", versionId: "v1" },
    { type: "asset.failed", asset: "seo", code: "CONTENT_REFUSED" },
    { type: "pipeline.status", status: "partial" },
  ])("accepte %o", (event) => {
    expect(PipelineEventSchema.safeParse(event).success).toBe(true);
  });

  it.each([
    { type: "asset.started", asset: "video" },
    { type: "asset.partial", asset: "seo", scenes: [] },
    { type: "pipeline.status", status: "done" },
    { type: "inconnu" },
  ])("rejette %o", (event) => {
    expect(PipelineEventSchema.safeParse(event).success).toBe(false);
  });
});
