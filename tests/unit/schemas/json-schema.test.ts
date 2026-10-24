import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ASSET_TYPES, assetSchemas } from "@/lib/ai/schemas";

// Le JSON Schema de chaque asset est envoyé à l'API comme `input_schema` de l'outil forcé.
describe("conversion en JSON Schema", () => {
  it("couvre les 5 types d'assets", () => {
    expect(ASSET_TYPES).toEqual(["script", "titles", "seo", "voiceover", "thumbnails"]);
    expect(Object.keys(assetSchemas).sort()).toEqual([...ASSET_TYPES].sort());
  });

  it.each(ASSET_TYPES)("produit un objet JSON Schema pour %s", (type) => {
    const json = z.toJSONSchema(assetSchemas[type]) as { type: string; required: string[]; properties: object };
    expect(json.type).toBe("object");
    expect(json.required.length).toBeGreaterThan(0);
    expect(Object.keys(json.properties)).toEqual(expect.arrayContaining(json.required));
  });

  it("n'exige pas du modèle les chapitres horodatés, calculés en code", () => {
    const json = z.toJSONSchema(assetSchemas.seo) as { required: string[] };
    expect(json.required).toContain("chapterTitles");
    expect(json.required).not.toContain("chapters");
  });
});
