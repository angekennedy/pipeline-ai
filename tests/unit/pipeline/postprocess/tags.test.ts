import { describe, expect, it } from "vitest";
import { TAGS_MAX_CHARS, normalizeTags, tagsCharCount } from "@/lib/pipeline/postprocess/tags";

describe("tagsCharCount", () => {
  it("compte les virgules entre les tags", () => {
    expect(tagsCharCount(["a", "bc"])).toBe(4);
  });

  it("compte 2 guillemets pour un tag qui contient un espace (règle YouTube)", () => {
    expect(tagsCharCount(["égypte ancienne"])).toBe(17);
  });

  it("vaut 0 pour une liste vide", () => {
    expect(tagsCharCount([])).toBe(0);
  });
});

describe("normalizeTags", () => {
  it("met en minuscules, retire # et les espaces superflus", () => {
    expect(normalizeTags(["  Égypte   Ancienne ", "#Gizeh"])).toEqual(["égypte ancienne", "gizeh"]);
  });

  it("supprime les doublons après normalisation et les tags vides", () => {
    expect(normalizeTags(["Gizeh", "gizeh ", " #GIZEH", "", "   ", "#"])).toEqual(["gizeh"]);
  });

  it(`ne dépasse jamais ${TAGS_MAX_CHARS} caractères au total`, () => {
    const many = Array.from({ length: 80 }, (_, i) => `tag numero ${i}`);
    const result = normalizeTags(many);
    expect(tagsCharCount(result)).toBeLessThanOrEqual(TAGS_MAX_CHARS);
    expect(result.length).toBeGreaterThan(0);
  });

  it("écarte un tag de plus de 30 caractères, sans perdre les autres", () => {
    expect(normalizeTags(["pyramides", "construction des pyramides de gizeh", "gizeh"])).toEqual(["pyramides", "gizeh"]);
  });

  it("saute un tag trop long mais garde les suivants qui tiennent, dans l'ordre", () => {
    const filler = Array.from({ length: 16 }, (_, i) => `x${String(i).padStart(28, "0")}`); // 16 × 29 + 15 virgules = 479
    const result = normalizeTags([...filler, "y".repeat(30), "court"]);
    expect(result.slice(-1)).toEqual(["court"]);
    expect(result).not.toContain("y".repeat(30));
    expect(tagsCharCount(result)).toBeLessThanOrEqual(TAGS_MAX_CHARS);
  });
});
