import { describe, expect, it } from "vitest";
import type { Titles } from "@/lib/ai/schemas/titles";
import { recountTitles } from "@/lib/pipeline/postprocess/titles";
import { validTitles } from "../../../fixtures/assets";

describe("recountTitles", () => {
  it("recalcule charCount au lieu de croire le modèle", () => {
    const titles = structuredClone(validTitles) as Titles;
    titles.variants[0]!.charCount = 999;
    expect(recountTitles(titles).variants[0]!.charCount).toBe(titles.variants[0]!.title.length);
  });

  it("compte un emoji comme un seul caractère", () => {
    const titles = structuredClone(validTitles) as Titles;
    titles.variants[0]!.title = "Égypte 🔥";
    expect(recountTitles(titles).variants[0]!.charCount).toBe(8);
  });

  it("ne modifie pas l'objet d'origine", () => {
    const titles = structuredClone(validTitles) as Titles;
    titles.variants[0]!.charCount = 999;
    recountTitles(titles);
    expect(titles.variants[0]!.charCount).toBe(999);
  });
});
