import { describe, expect, it } from "vitest";
import type { PromptContext } from "@/lib/ai/prompts";
import { ASSET_TYPES, type Brief, type ChannelPreset, type Script, type Titles } from "@/lib/ai/schemas";
import { registry } from "@/lib/pipeline/registry";
import { validBrief, validChannel, validScript, validSeo, validThumbnails, validTitles, validVoiceover } from "../../fixtures/assets";

const brief = (overrides: Partial<Brief> = {}) => ({ ...validBrief, ...overrides }) as Brief;
const context = (overrides: Partial<PromptContext> = {}): PromptContext => ({
  brief: brief(),
  channel: validChannel as ChannelPreset,
  script: structuredClone(validScript) as Script,
  titles: structuredClone(validTitles) as Titles,
  ...overrides,
});

describe("registry", () => {
  it.each(ASSET_TYPES)("%s : définition cohérente avec son type, son prompt et sa version de schéma", (type) => {
    const def = registry[type];
    expect(def.type).toBe(type);
    expect(def.prompt.version).toMatch(new RegExp(`^${type}@`));
    expect(def.schemaVersion).toMatch(new RegExp(`^${type}@\\d+$`));
  });

  it("déclare les dépendances : tout dérive du script, les miniatures aussi des titres", () => {
    expect(Object.fromEntries(ASSET_TYPES.map((t) => [t, registry[t].dependsOn]))).toEqual({
      script: [],
      titles: ["script"],
      seo: ["script"],
      voiceover: ["script"],
      thumbnails: ["script", "titles"],
    });
  });

  it("choisit le modèle du script selon le plan, le modèle léger pour les dérivés", () => {
    expect(registry.script.modelKey("standard")).toBe("script.standard");
    expect(registry.script.modelKey("premium")).toBe("script.premium");
    for (const type of ["titles", "seo", "voiceover", "thumbnails"] as const) {
      expect(registry[type].modelKey("premium")).toBe("light");
    }
  });

  it.each([
    // [type, durée, plan, crédits] : grille ARCHITECTURE §5.1, hypothèses à calibrer
    ["script", 8, "standard", 12],
    ["script", 8, "premium", 24],
    ["titles", 8, "standard", 1],
    ["seo", 8, "standard", 2],
    ["voiceover", 8, "standard", 2],
    ["voiceover", 25, "standard", 4],
    ["thumbnails", 60, "premium", 1], // concepts seuls ; 15 avec les images HD des plans payants
  ] as const)("%s, %i min, %s : %i crédits", (type, durationMinutes, tier, credits) => {
    expect(registry[type].credits(brief({ durationMinutes }), tier)).toBe(credits);
  });

  it.each(ASSET_TYPES)("%s : budget de tokens croissant avec la durée, sous la limite de sortie", (type) => {
    const short = registry[type].maxTokens(brief({ durationMinutes: 1 }));
    const long = registry[type].maxTokens(brief({ durationMinutes: 60, language: "es" }));
    expect(short).toBeGreaterThanOrEqual(4000); // le thinking compte dans max_tokens
    expect(long).toBeGreaterThanOrEqual(short);
    expect(long).toBeLessThanOrEqual(64_000);
  });

  it("budget du script : environ 4 tokens par mot de narration visé, plus une marge fixe", () => {
    expect(registry.script.maxTokens(brief({ durationMinutes: 8, language: "fr" }))).toBe(8000 + 1200 * 4);
  });
});

describe("post-traitements", () => {
  it("script : recalcule les durées des scènes", () => {
    const script = { ...validScript, scenes: validScript.scenes.map((s) => ({ ...s, estimatedSeconds: 999 })) } as Script;
    const out = registry.script.postProcess(script, context());
    expect(out.scenes.map((s) => s.estimatedSeconds)).not.toContain(999);
  });

  it("titres : recompte les caractères", () => {
    const titles = structuredClone(validTitles) as Titles;
    titles.variants[0]!.charCount = 0;
    expect(registry.titles.postProcess(titles, context()).variants[0]!.charCount).toBe(36);
  });

  it("SEO : normalise les tags et calcule les chapitres depuis les scènes", () => {
    const seo = { ...validSeo, tags: ["Pyramides", "pyramides", "#Gizeh"] };
    const out = registry.seo.postProcess(seo, context());
    expect(out.tags).toEqual(["pyramides", "gizeh"]);
    expect(out.chapters).toEqual([
      { timestamp: "00:00", title: "Le bloc impossible" },
      { timestamp: "00:12", title: "Le contexte" },
      { timestamp: "00:52", title: "La rampe intérieure" },
    ]);
  });

  it("SEO : omet les chapitres quand les règles YouTube ne sont pas tenables", () => {
    const scenes = validScript.scenes.map((s) => ({ ...s, estimatedSeconds: 5 }));
    const out = registry.seo.postProcess(validSeo, context({ script: { ...validScript, scenes } as Script }));
    expect(out.chapters).toBeUndefined();
  });

  it("voix off et miniatures : sortie inchangée", () => {
    expect(registry.voiceover.postProcess(validVoiceover as never, context())).toEqual(validVoiceover);
    expect(registry.thumbnails.postProcess(validThumbnails as never, context())).toEqual(validThumbnails);
  });
});

describe("validation dans le contexte du pipeline", () => {
  const issues = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
    result.error?.issues.map(({ path, message }) => ({ path, message })) ?? [];

  it("SEO : un chapitre ne peut pas commencer sur une scène inexistante", () => {
    const seo = { ...validSeo, chapterTitles: [...validSeo.chapterTitles, { startsAtSceneIndex: 9, title: "Fin" }] };
    expect(registry.seo.schema(context()).safeParse(validSeo).success).toBe(true);
    expect(issues(registry.seo.schema(context()).safeParse(seo))).toEqual([
      { path: ["chapterTitles", 3, "startsAtSceneIndex"], message: "Scène inexistante (le script en compte 4)" },
    ]);
  });

  it("voix off : exactement un segment par scène du script", () => {
    const four = [1, 2, 3, 4].map((sceneIndex) => ({ ...validVoiceover.segments[0]!, sceneIndex }));
    expect(registry.voiceover.schema(context()).safeParse({ ...validVoiceover, segments: four }).success).toBe(true);

    const wrong = [...four.slice(0, 2), { ...four[0]!, sceneIndex: 7 }];
    expect(issues(registry.voiceover.schema(context()).safeParse({ ...validVoiceover, segments: wrong }))).toEqual([
      { path: ["segments", 2, "sceneIndex"], message: "Scène inexistante (le script en compte 4)" },
      { path: ["segments"], message: "Scènes sans segment : 3, 4" },
    ]);
  });

  it("miniatures : chaque concept vise un titre existant, et des titres différents", () => {
    expect(registry.thumbnails.schema(context()).safeParse(validThumbnails).success).toBe(true);

    const concepts = validThumbnails.concepts.map((c, i) => ({ ...c, pairedTitleIndex: [0, 0, 5][i]! }));
    expect(issues(registry.thumbnails.schema(context()).safeParse({ concepts }))).toEqual([
      { path: ["concepts", 1, "pairedTitleIndex"], message: "Titre déjà utilisé par un autre concept" },
      { path: ["concepts", 2, "pairedTitleIndex"], message: "Titre inexistant (5 variantes)" },
    ]);
  });

  it("garde les règles propres au schéma (index de scènes consécutifs du script)", () => {
    const script = { ...validScript, scenes: validScript.scenes.map((s) => ({ ...s, index: 1 })) };
    expect(registry.script.schema(context()).safeParse(script).success).toBe(false);
    expect(registry.titles.schema(context()).safeParse({ ...validTitles, recommendedIndex: 9 }).success).toBe(false);
  });
});

describe("sortie du modèle plus souple que le contrat stocké", () => {
  const concepts = (texts: string[]) => texts.map((text, i) => ({ ...validThumbnails.concepts[0]!, pairedTitleIndex: i, textOverlay: { ...validThumbnails.concepts[0]!.textOverlay, text } }));

  it("SEO : un tag trop long est accepté en sortie, refusé à l'édition, puis écarté", () => {
    const seo = { ...validSeo, tags: ["pyramides", "construction des pyramides de gizeh"] };
    expect(registry.seo.outputSchema!(context()).safeParse(seo).success).toBe(true);
    expect(registry.seo.schema(context()).safeParse(seo).success).toBe(false);
    expect(registry.seo.postProcess(seo, context()).tags).toEqual(["pyramides"]);
  });

  it("miniatures : un concept trop verbeux parmi 4 est accepté en sortie puis écarté", () => {
    const thumbnails = { concepts: concepts(["SANS POULIE", "UN DEUX TROIS QUATRE CINQ", "LE CODE", "INEXPLIQUÉ ?"]) };
    expect(registry.thumbnails.outputSchema!(context()).safeParse(thumbnails).success).toBe(true);
    expect(registry.thumbnails.schema(context()).safeParse(thumbnails).success).toBe(false); // éditions : contrat strict
    expect(registry.thumbnails.postProcess(thumbnails as never, context()).concepts.map((c) => c.textOverlay.text)).toEqual([
      "SANS POULIE",
      "LE CODE",
      "INEXPLIQUÉ ?",
    ]);
  });

  it("miniatures : s'il resterait moins de 3 concepts, la réparation vise seulement les fautifs", () => {
    const thumbnails = { concepts: concepts(["SANS POULIE", "UN DEUX TROIS QUATRE CINQ", "LE CODE"]) };
    const result = registry.thumbnails.outputSchema!(context()).safeParse(thumbnails);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(({ path, message }) => ({ path, message }))).toEqual([
      { path: ["concepts", 1, "textOverlay", "text"], message: "« UN DEUX TROIS QUATRE CINQ » compte 5 mots : 4 au maximum" },
    ]);
  });

  it("garde les règles du pipeline dans la sortie du modèle (titre inexistant)", () => {
    const thumbnails = { concepts: concepts(["A", "B", "C"]).map((c, i) => ({ ...c, pairedTitleIndex: i === 2 ? 9 : i })) };
    expect(registry.thumbnails.outputSchema!(context()).safeParse(thumbnails).success).toBe(false);
  });
});

describe("longueur de la narration d'une vidéo", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `mot${i}`).join(" ") + ".";
  const scriptOf = (total: number) => ({
    ...validScript,
    scenes: validScript.scenes.map((scene, i) => ({ ...scene, narration: words(i === 0 ? total - 3 * Math.floor(total / 4) : Math.floor(total / 4)) })),
  });
  // 1 min en français : 150 mots visés, 128 au moins (tolérance de 15 %).
  const video = context({ brief: { ...validBrief, durationMinutes: 1, video: true } as Brief });

  it("demande de compléter une narration trop courte, avec les mots manquants", () => {
    const result = registry.script.outputSchema!(video).safeParse(scriptOf(100));
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]).toMatchObject({ path: ["scenes"], message: expect.stringContaining("compte 100 mots : il en faut au moins 128 (cible 150)") });
  });

  it("accepte une narration dans la tolérance", () => {
    expect(registry.script.outputSchema!(video).safeParse(scriptOf(130)).success).toBe(true);
  });

  it("ne contrôle pas la longueur sans vidéo, ni pour les éditions", () => {
    const text = context({ brief: { ...validBrief, durationMinutes: 1 } as Brief });
    expect(registry.script.outputSchema!(text).safeParse(scriptOf(100)).success).toBe(true);
    expect(registry.script.schema(video).safeParse(scriptOf(100)).success).toBe(true);
  });
});
