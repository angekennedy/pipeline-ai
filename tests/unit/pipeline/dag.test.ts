import { describe, expect, it } from "vitest";
import type { AssetType } from "@/lib/ai/schemas";
import { PIPELINE_STAGES, buildStages, dependentsOf } from "@/lib/pipeline/dag";

const deps = (graph: Partial<Record<AssetType, AssetType[]>>) =>
  Object.fromEntries(Object.entries(graph).map(([type, dependsOn]) => [type, { dependsOn }]));

describe("PIPELINE_STAGES", () => {
  it("lance le script, puis titres, SEO et voix off en parallèle, puis les miniatures", () => {
    expect(PIPELINE_STAGES).toEqual([["script"], ["titles", "seo", "voiceover"], ["thumbnails"]]);
  });
});

describe("buildStages", () => {
  it("place chaque asset dans l'étape qui suit sa dépendance la plus tardive", () => {
    expect(buildStages(deps({ script: [], titles: ["script"], thumbnails: ["titles", "script"] }))).toEqual([
      ["script"],
      ["titles"],
      ["thumbnails"],
    ]);
  });

  it("refuse un cycle", () => {
    expect(() => buildStages(deps({ script: ["seo"], seo: ["script"] }))).toThrow(/cycle.*script.*seo|cycle.*seo.*script/i);
  });

  it("refuse une dépendance absente du graphe", () => {
    expect(() => buildStages(deps({ titles: ["script"] }))).toThrow(/script/);
  });
});

describe("dependentsOf", () => {
  it("liste les assets à marquer obsolètes, dépendances indirectes comprises", () => {
    expect(dependentsOf("script")).toEqual(["titles", "seo", "voiceover", "thumbnails"]);
    expect(dependentsOf("titles")).toEqual(["thumbnails"]);
    expect(dependentsOf("seo")).toEqual([]);
  });
});
