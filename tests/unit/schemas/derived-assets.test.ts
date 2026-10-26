import { describe, expect, it } from "vitest";
import { SeoSchema } from "@/lib/ai/schemas/seo";
import { ThumbnailsSchema } from "@/lib/ai/schemas/thumbnails";
import { TitlesSchema } from "@/lib/ai/schemas/titles";
import { VoiceoverSchema } from "@/lib/ai/schemas/voiceover";
import { validSeo, validThumbnails, validTitles, validVoiceover } from "../../fixtures/assets";

describe("TitlesSchema", () => {
  const titles = () => structuredClone(validTitles);

  it("accepte des titres valides", () => {
    expect(TitlesSchema.safeParse(titles()).success).toBe(true);
  });

  it("exige entre 5 et 10 variantes", () => {
    const t = titles();
    t.variants = t.variants.slice(0, 4);
    expect(TitlesSchema.safeParse(t).success).toBe(false);
  });

  it("rejette un titre de plus de 100 caractères (limite YouTube)", () => {
    const t = titles();
    t.variants[0]!.title = "x".repeat(101);
    expect(TitlesSchema.safeParse(t).success).toBe(false);
  });

  it("rejette un score heuristique hors de 1 à 10", () => {
    const t = titles();
    t.variants[0]!.heuristicScore = 11;
    expect(TitlesSchema.safeParse(t).success).toBe(false);
  });

  it("exige un index recommandé qui désigne une variante existante", () => {
    const t = titles();
    t.recommendedIndex = 5;
    const result = TitlesSchema.safeParse(t);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["recommendedIndex"]);
  });
});

describe("SeoSchema", () => {
  const seo = () => structuredClone(validSeo) as typeof validSeo & { hashtags: string[] };

  it("accepte un SEO valide, sans chapitres horodatés (calculés plus tard)", () => {
    expect(SeoSchema.safeParse(seo()).success).toBe(true);
  });

  it("rejette une description de plus de 5000 caractères", () => {
    expect(SeoSchema.safeParse({ ...seo(), description: "x".repeat(5001) }).success).toBe(false);
  });

  it.each(["pyramides", "#", "#1pyramide", "#mot clé"])("rejette le hashtag invalide %j", (tag) => {
    expect(SeoSchema.safeParse({ ...seo(), hashtags: [tag] }).success).toBe(false);
  });

  it("accepte un hashtag accentué", () => {
    expect(SeoSchema.safeParse({ ...seo(), hashtags: ["#égypte_ancienne"] }).success).toBe(true);
  });

  it("limite les hashtags à 3", () => {
    expect(SeoSchema.safeParse({ ...seo(), hashtags: ["#a", "#b", "#c", "#d"] }).success).toBe(false);
  });

  it("exige au moins 3 titres de chapitres", () => {
    const s = seo();
    s.chapterTitles = s.chapterTitles.slice(0, 2);
    expect(SeoSchema.safeParse(s).success).toBe(false);
  });
});

describe("VoiceoverSchema", () => {
  const vo = () => structuredClone(validVoiceover);

  it("accepte une voix off valide", () => {
    expect(VoiceoverSchema.safeParse(vo()).success).toBe(true);
  });

  it("exige au moins un segment", () => {
    expect(VoiceoverSchema.safeParse({ ...vo(), segments: [] }).success).toBe(false);
  });

  it("borne la pause après un segment à 3 secondes", () => {
    const v = vo();
    v.segments[0]!.pauseAfterMs = 3001;
    expect(VoiceoverSchema.safeParse(v).success).toBe(false);
  });

  it("refuse deux segments pour la même scène", () => {
    const v = vo();
    v.segments.push(structuredClone(v.segments[0]!));
    const result = VoiceoverSchema.safeParse(v);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["segments", 1, "sceneIndex"]);
  });
});

describe("ThumbnailsSchema", () => {
  const thumbs = () => structuredClone(validThumbnails);

  it("accepte des miniatures valides", () => {
    expect(ThumbnailsSchema.safeParse(thumbs()).success).toBe(true);
  });

  it("exige 3 ou 4 concepts", () => {
    const t = thumbs();
    t.concepts = t.concepts.slice(0, 2);
    expect(ThumbnailsSchema.safeParse(t).success).toBe(false);
  });

  it("limite le texte en overlay à 4 mots", () => {
    const t = thumbs();
    t.concepts[0]!.textOverlay.text = "UN DEUX TROIS QUATRE CINQ";
    const result = ThumbnailsSchema.safeParse(t);
    expect(result.success).toBe(false);
    // Message destiné à la réparation : le modèle voit le texte fautif et son nombre de mots.
    expect(result.error?.issues[0]).toMatchObject({
      path: ["concepts", 0, "textOverlay", "text"],
      message: "« UN DEUX TROIS QUATRE CINQ » compte 5 mots : 4 au maximum",
    });
  });

  it("accepte 4 mots en overlay, petits mots compris", () => {
    const t = thumbs();
    t.concepts[0]!.textOverlay.text = "LE CODE DE GIZEH";
    expect(ThumbnailsSchema.safeParse(t).success).toBe(true);
  });

  it("rejette une couleur qui n'est pas un hexadécimal à 6 chiffres", () => {
    const t = thumbs();
    t.concepts[0]!.textOverlay.colorHex = "#FFF";
    expect(ThumbnailsSchema.safeParse(t).success).toBe(false);
  });

  it("impose le format 16:9", () => {
    const t = thumbs() as { concepts: Array<{ aspectRatio: string }> };
    t.concepts[0]!.aspectRatio = "9:16";
    expect(ThumbnailsSchema.safeParse(t).success).toBe(false);
  });
});
