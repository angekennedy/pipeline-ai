import { describe, expect, it } from "vitest";
import type { Brief } from "@/lib/ai/schemas";
import { regenerationCredits, staleAssets, type CurrentVersions } from "@/lib/pipeline/staleness";
import { validBrief } from "../../fixtures/assets";

const v = (id: string, sourceVersions: Record<string, string> = {}, restoredFrom: string | null = null) => ({ id, sourceVersions, restoredFrom });

// Pipeline à jour : chaque dérivé a été produit à partir des versions courantes.
const fresh: CurrentVersions = {
  script: v("s1"),
  titles: v("t1", { script: "s1" }),
  seo: v("o1", { script: "s1" }),
  voiceover: v("v1", { script: "s1" }),
  thumbnails: v("m1", { script: "s1", titles: "t1" }),
};

describe("staleAssets", () => {
  it("pipeline à jour : rien d'obsolète", () => {
    expect(staleAssets(fresh)).toEqual([]);
  });

  it("nouveau script : tous les dérivés deviennent obsolètes", () => {
    expect(staleAssets({ ...fresh, script: v("s2") })).toEqual(["titles", "seo", "voiceover", "thumbnails"]);
  });

  it("nouveaux titres : seules les miniatures, qui s'y réfèrent, deviennent obsolètes", () => {
    expect(staleAssets({ ...fresh, titles: v("t2", { script: "s1" }) })).toEqual(["thumbnails"]);
  });

  it("un dérivé régénéré à partir du nouveau script redevient à jour", () => {
    expect(staleAssets({ ...fresh, script: v("s2"), seo: v("o2", { script: "s2" }) })).toEqual(["titles", "voiceover", "thumbnails"]);
  });

  it("des miniatures à jour par rapport à des titres obsolètes restent obsolètes", () => {
    const current = { ...fresh, script: v("s2"), thumbnails: v("m2", { script: "s2", titles: "t1" }) };
    expect(staleAssets(current)).toContain("thumbnails");
  });

  it("restaurer la version d'origine du script remet à jour les dérivés produits à partir d'elle", () => {
    expect(staleAssets({ ...fresh, script: v("s3", {}, "s1") })).toEqual([]);
  });

  it("compare les origines : un dérivé produit à partir d'une copie restaurée reste à jour après une nouvelle restauration", () => {
    // Les dépendances sont enregistrées par leur origine (loadContext) : s3 et s4 sont deux copies de s1.
    const current = { ...fresh, script: v("s4", {}, "s1"), titles: v("t2", { script: "s1" }) };
    expect(staleAssets(current)).not.toContain("titles");
  });

  it("un asset sans version n'est pas obsolète, il est à générer", () => {
    expect(staleAssets({ script: v("s1"), titles: null })).toEqual([]);
  });
});

describe("regenerationCredits", () => {
  it("additionne le coût des assets à régénérer, selon le brief et la formule", () => {
    const brief = { ...validBrief, durationMinutes: 8 } as Brief;
    expect(regenerationCredits(["titles", "seo", "voiceover", "thumbnails"], brief, "standard")).toBe(1 + 2 + 2 + 1);
    expect(regenerationCredits(["script"], brief, "premium")).toBe(8 + 2 * 8);
    expect(regenerationCredits([], brief, "standard")).toBe(0);
  });
});
