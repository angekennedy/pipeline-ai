import { describe, expect, it } from "vitest";
import { applyPipelineEvent, initialLiveState, refreshesPage } from "@/lib/realtime/pipeline-state";
import type { PipelineEvent } from "@/lib/realtime/events";
import type { Scene } from "@/lib/ai/schemas";
import { validScript } from "../../fixtures/assets";

const [s1, s2, s3] = validScript.scenes as Scene[];
const apply = (...events: PipelineEvent[]) => events.reduce(applyPipelineEvent, initialLiveState("running"));

describe("applyPipelineEvent", () => {
  it("part du statut lu en base, sans asset ni scène", () => {
    expect(initialLiveState("queued")).toEqual({ status: "queued", assets: {}, scenes: [] });
    expect(initialLiveState()).toEqual({ status: null, assets: {}, scenes: [] });
  });

  it("suit le statut de chaque asset", () => {
    const state = apply(
      { type: "asset.started", asset: "script" },
      { type: "asset.completed", asset: "script", versionId: "v1" },
      { type: "asset.started", asset: "seo" },
      { type: "asset.failed", asset: "seo", code: "CONTENT_REFUSED" },
    );
    expect(state.assets).toEqual({ script: "ready", seo: "failed" });
  });

  it("ajoute les scènes dans l'ordre des index, même reçues dans le désordre", () => {
    const state = apply({ type: "asset.partial", asset: "script", scenes: [s3!] }, { type: "asset.partial", asset: "script", scenes: [s1!, s2!] });
    expect(state.scenes.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it("remplace une scène renvoyée avec le même index (réparation)", () => {
    const fixed = { ...s1!, title: "Titre corrigé" };
    const state = apply({ type: "asset.partial", asset: "script", scenes: [s1!, s2!] }, { type: "asset.partial", asset: "script", scenes: [fixed] });
    expect(state.scenes).toEqual([fixed, s2]);
  });

  it("repart d'une liste vide quand le script redémarre", () => {
    const state = apply({ type: "asset.partial", asset: "script", scenes: [s1!] }, { type: "asset.started", asset: "script" });
    expect(state.scenes).toEqual([]);
  });

  it("garde les scènes quand un dérivé démarre", () => {
    const state = apply({ type: "asset.partial", asset: "script", scenes: [s1!] }, { type: "asset.started", asset: "titles" });
    expect(state.scenes).toEqual([s1]);
  });

  it("suit le statut du pipeline", () => {
    expect(apply({ type: "pipeline.status", status: "partial" }).status).toBe("partial");
  });

  it("ne modifie pas l'état précédent", () => {
    const before = initialLiveState("running");
    applyPipelineEvent(before, { type: "asset.started", asset: "script" });
    expect(before).toEqual(initialLiveState("running"));
  });
});

describe("refreshesPage", () => {
  it.each([
    [{ type: "asset.completed", asset: "titles", versionId: "v" }, true],
    [{ type: "asset.failed", asset: "seo", code: "X" }, true],
    [{ type: "pipeline.status", status: "completed" }, true],
    [{ type: "asset.started", asset: "seo" }, false],
    [{ type: "asset.partial", asset: "script", scenes: [] }, false],
  ] as Array<[PipelineEvent, boolean]>)("%o → %s", (event, expected) => {
    expect(refreshesPage(event)).toBe(expected);
  });
});
