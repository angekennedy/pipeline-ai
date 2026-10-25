import { describe, expect, it } from "vitest";
import { ASSET_TYPES } from "@/lib/ai/schemas";
import { emptyPipelineView, mergeLiveState, revealAsset } from "@/lib/pipeline/view";
import { initialLiveState } from "@/lib/realtime/pipeline-state";
import { demoPipeline } from "@/lib/demo/pipelines";
import type { Brief } from "@/lib/ai/schemas";
import { validBrief } from "../../fixtures/assets";

const pending = () => emptyPipelineView({ id: "p1", brief: validBrief as Brief, tier: "standard", createdAt: "2026-10-24T10:00:00Z" });

describe("emptyPipelineView", () => {
  it("crée un pipeline en file d'attente, tous ses assets en attente", () => {
    const view = pending();
    expect(view.status).toBe("queued");
    for (const type of ASSET_TYPES) expect(view.assets[type]).toEqual({ status: "pending", content: null, error: null });
  });
});

describe("mergeLiveState", () => {
  it("affiche le statut en direct d'un asset tant que la base ne l'a pas terminé", () => {
    const live = { ...initialLiveState("running"), assets: { script: "running" as const } };
    const merged = mergeLiveState(pending(), live);
    expect(merged.status).toBe("running");
    expect(merged.assets.script.status).toBe("running");
    expect(merged.assets.titles.status).toBe("pending");
  });

  it("garde l'asset en cours tant que la page n'a pas relu son contenu en base", () => {
    const live = { ...initialLiveState(), assets: { titles: "ready" as const } };
    expect(mergeLiveState(pending(), live).assets.titles.status).toBe("running");
  });

  it("donne raison à la base pour un asset terminé et pour un statut final", () => {
    const view = demoPipeline("demo-partial")!.view;
    const live = { ...initialLiveState("running"), assets: { seo: "running" as const, script: "running" as const } };
    const merged = mergeLiveState(view, live);
    expect(merged.status).toBe("partial");
    expect(merged.assets.seo.status).toBe("failed");
    expect(merged.assets.script.status).toBe("ready");
  });

  it("signale un échec reçu en direct", () => {
    const live = { ...initialLiveState(), assets: { seo: "failed" as const } };
    expect(mergeLiveState(pending(), live).assets.seo.status).toBe("failed");
  });
});

describe("revealAsset", () => {
  it("copie un asset terminé depuis la vue finale, sans toucher aux autres", () => {
    const final = demoPipeline("demo-completed")!.view;
    const view = revealAsset(pending(), final, "titles");
    expect(view.assets.titles).toEqual(final.assets.titles);
    expect(view.assets.script.status).toBe("pending");
  });
});
