import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { ASSET_TYPES } from "@/lib/ai/schemas";
import { EXAMPLE_IDS, example, exampleFor } from "@/lib/demo/examples";
import { PRIVATE_PREFIXES, siteUrl } from "@/lib/site";
import financeEn from "@/lib/demo/examples/en-finance-compound.json";
import romeFr from "@/lib/demo/examples/fr-histoire-rome.json";

// Exemples réels de la landing (tâche 5.1) : sorties de l'évaluation v3, acceptées par les contrats
// actuels. Si un schéma ou un post-traitement change au point de les refuser, ce test le dit.
describe("pipelines d'exemple réels", () => {
  it.each(EXAMPLE_IDS)("%s : les cinq assets passent les contrats actuels, pipeline terminé", (id) => {
    const { view, meta } = example(id)!;
    expect(view.status).toBe("completed");
    for (const type of ASSET_TYPES) {
      expect(view.assets[type], type).toMatchObject({ status: "ready", error: null, stale: false });
      expect(view.assets[type].content, type).not.toBeNull();
    }
    expect(meta.models).toEqual({ script: "claude-sonnet-5-5", derived: "claude-haiku-5-5" });
    expect(meta.judge).toBeGreaterThanOrEqual(4.5);
  });

  it("garde le brief, le coût et la durée mesurés, sans retouche du texte du modèle", () => {
    const { view, meta } = example("demo-rome")!;
    expect(view.brief).toEqual(romeFr.brief);
    expect(meta).toMatchObject({ costUsd: 0.2231, generationSeconds: 168 });
    // Le post-traitement recalcule durées et comptes, il ne réécrit pas la narration.
    expect(view.assets.script.content!.scenes.map((scene) => scene.narration)).toEqual(romeFr.assets.script.scenes.map((scene) => scene.narration));
    expect(example("demo-compound-interest")!.view.brief.language).toBe(financeEn.brief.language);
  });

  it("choisit l'exemple dans la langue de l'interface, et ignore un id inconnu", () => {
    expect(exampleFor("fr")).toBe("demo-rome");
    expect(exampleFor("en")).toBe("demo-compound-interest");
    expect(example("demo-inconnu")).toBeNull();
    expect(example("demo-rome")).toBe(example("demo-rome")); // construit une fois
  });
});

describe("sitemap et robots", () => {
  it("prend le domaine configuré, puis celui de Vercel, puis le serveur local", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://pipeline.example", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" }).origin).toBe("https://pipeline.example");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "pipeline-ai.vercel.app" }).origin).toBe("https://pipeline-ai.vercel.app");
    expect(siteUrl({}).origin).toBe("http://localhost:3000");
  });

  it("liste les pages publiques, exemples réels compris, en URL absolues", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual([
      "http://localhost:3000/",
      "http://localhost:3000/pricing",
      "http://localhost:3000/pipelines/demo-rome",
      "http://localhost:3000/pipelines/demo-compound-interest",
    ]);
    expect(sitemap()[0]).toMatchObject({ priority: 1 });
  });

  it("ferme l'application, l'administration et l'API aux robots, et pointe le sitemap", () => {
    const rules = robots();
    expect(rules.sitemap).toBe("http://localhost:3000/sitemap.xml");
    expect(rules.rules).toEqual({ userAgent: "*", allow: "/", disallow: [...PRIVATE_PREFIXES] });
    expect(PRIVATE_PREFIXES).toEqual(expect.arrayContaining(["/admin", "/api/", "/w/", "/login"]));
  });
});
