import { describe, expect, it } from "vitest";
import type { PromptContext } from "@/lib/ai/prompts";
import { ASSET_TYPES, BriefSchema } from "@/lib/ai/schemas";
import { DEMO_PIPELINE_IDS, demoPipeline } from "@/lib/demo/pipelines";
import { demoTimeline } from "@/lib/demo/timeline";
import { registry } from "@/lib/pipeline/registry";
import { PipelineEventSchema } from "@/lib/realtime/events";
import { applyPipelineEvent, initialLiveState } from "@/lib/realtime/pipeline-state";

const completed = demoPipeline("demo-completed")!.view;

describe("pipelines de démonstration", () => {
  it("expose un pipeline par état à montrer, plus les exemples réels", () => {
    expect(DEMO_PIPELINE_IDS).toEqual(["demo-running", "demo-completed", "demo-partial", "demo-failed", "demo-stale", "demo-rome", "demo-compound-interest"]);
    expect(demoPipeline("inconnu")).toBeNull();
  });

  it("a un brief valide", () => {
    expect(BriefSchema.safeParse(completed.brief).success).toBe(true);
  });

  it("produit des assets conformes aux schémas et cohérents entre eux, comme une vraie génération", () => {
    const ctx: PromptContext = {
      brief: completed.brief,
      channel: null,
      script: completed.assets.script.content!,
      titles: completed.assets.titles.content!,
    };
    for (const type of ASSET_TYPES) {
      const result = registry[type].schema(ctx).safeParse(completed.assets[type].content);
      expect(result.success, `${type} : ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it("a des durées et des chapitres calculés par les post-traitements", () => {
    expect(completed.assets.seo.content!.chapters!.length).toBeGreaterThanOrEqual(3);
    expect(completed.assets.seo.content!.chapters![0]!.timestamp).toBe("00:00");
  });

  it("partial : SEO en échec, les quatre autres assets prêts", () => {
    const { view } = demoPipeline("demo-partial")!;
    expect(view.status).toBe("partial");
    expect(view.assets.seo).toMatchObject({ status: "failed", content: null, error: { code: "CONTENT_REFUSED" } });
    expect(ASSET_TYPES.filter((t) => view.assets[t].status === "ready")).toEqual(["script", "titles", "voiceover", "thumbnails"]);
  });

  it("failed : script en échec, dérivés sautés", () => {
    const { view } = demoPipeline("demo-failed")!;
    expect(view.status).toBe("failed");
    expect(view.assets.script.status).toBe("failed");
    expect(ASSET_TYPES.slice(1).map((t) => view.assets[t].status)).toEqual(["skipped", "skipped", "skipped", "skipped"]);
  });

  it("stale : script édité à la main, quatre dérivés obsolètes et coût de leur régénération", () => {
    const { view } = demoPipeline("demo-stale")!;
    expect(view.assets.script.versions.map((v) => [v.version, v.source])).toEqual([
      [2, "user_edit"],
      [1, "ai"],
    ]);
    expect(view.assets.script.stale).toBe(false);
    expect(ASSET_TYPES.filter((t) => view.assets[t].stale)).toEqual(["titles", "seo", "voiceover", "thumbnails"]);
    expect(view.staleCredits).toBe(1 + 2 + 2 + 1);
    expect(view.assets.script.content!.workingTitle).not.toBe(completed.assets.script.content!.workingTitle);
  });

  it("running : rejoue la génération depuis un pipeline vide", () => {
    const demo = demoPipeline("demo-running")!;
    if (!demo.replay) throw new Error("demo-running doit rejouer la génération");
    expect(demo.view.status).toBe("queued");
    expect(demo.final.status).toBe("completed");
    expect(demoPipeline("demo-completed")!.replay).toBe(false);
  });
});

describe("demoTimeline", () => {
  const timeline = demoTimeline(completed);

  it("émet des événements valides, dans l'ordre chronologique", () => {
    for (const { event } of timeline) expect(PipelineEventSchema.safeParse(event).success).toBe(true);
    const times = timeline.map(({ at }) => at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("montre la première scène en moins de 10 s", () => {
    const first = timeline.find(({ event }) => event.type === "asset.partial")!;
    expect(first.at).toBeLessThan(10_000);
  });

  it("aboutit à l'état final : scènes du script, assets prêts, pipeline terminé", () => {
    const live = timeline.reduce((state, { event }) => applyPipelineEvent(state, event), initialLiveState("queued"));
    expect(live.status).toBe("completed");
    expect(live.scenes).toHaveLength(completed.assets.script.content!.scenes.length);
    for (const type of ASSET_TYPES) expect(live.assets[type]).toBe("ready");
  });

  it("lance les miniatures après les titres, et le reste après le script", () => {
    const at = (type: string, asset: string) => timeline.find(({ event }) => event.type === type && "asset" in event && event.asset === asset)!.at;
    expect(at("asset.started", "thumbnails")).toBeGreaterThanOrEqual(at("asset.completed", "titles"));
    expect(at("asset.started", "seo")).toBeGreaterThanOrEqual(at("asset.completed", "script"));
  });

  it("rejoue un échec comme un asset.failed", () => {
    const events = demoTimeline(demoPipeline("demo-partial")!.view).map(({ event }) => event);
    expect(events).toContainEqual({ type: "asset.failed", asset: "seo", code: "CONTENT_REFUSED" });
    expect(events.at(-1)).toEqual({ type: "pipeline.status", status: "partial" });
  });
});
