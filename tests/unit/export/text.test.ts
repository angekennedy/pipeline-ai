import { describe, expect, it } from "vitest";
import type { Script, Seo, Thumbnails, Titles, Voiceover } from "@/lib/ai/schemas";
import { narrationToText, scriptToText, seoToText, tagsToText, thumbnailsToText, titlesToText, voiceoverToText } from "@/lib/export/text";
import { tEn, tFr } from "../../fixtures/i18n";
import { validScript, validSeo, validThumbnails, validTitles, validVoiceover } from "../../fixtures/assets";

const script = validScript as Script;
const titles = validTitles as Titles;

describe("export texte", () => {
  it("script : scènes horodatées avec narration, visuel, texte à l'écran et points à vérifier", () => {
    const text = scriptToText(script, tFr);
    expect(text.startsWith("Comment les pyramides ont vraiment été construites\n")).toBe(true);
    expect(text).toContain("[00:00 · Accroche] 1. Le bloc impossible");
    expect(text).toContain("[00:12 · Contexte] 2. Gizeh, 2560 av. J.-C.");
    expect(text).toContain("Texte à l'écran : 2,5 tonnes");
    expect(text).not.toContain("Texte à l'écran : null");
    expect(text).toContain("Appel à l'action : Abonnez-vous pour le prochain mystère");
    expect(text).toContain("Points à vérifier :\n- Scène 2 : Construction vers 2560 av. J.-C.");
    expect(text).toMatchSnapshot();
  });

  it("script sans point à vérifier : pas de section vide", () => {
    expect(scriptToText({ ...script, factCheckFlags: [] }, tFr)).not.toContain("Points à vérifier");
  });

  it("narration seule, un paragraphe par scène, pour la voix off ou un prompteur", () => {
    const text = narrationToText(script);
    expect(text.split("\n\n")).toHaveLength(4);
    expect(text).not.toContain("Visuel");
  });

  it("titres : liste numérotée, variante recommandée signalée", () => {
    const text = titlesToText(titles, tFr);
    expect(text.split("\n")[0]).toBe("1. Le secret des pyramides enfin révélé (recommandé)");
    expect(text.split("\n")).toHaveLength(5);
  });

  it("SEO : description, chapitres horodatés puis hashtags, prêts à coller dans YouTube", () => {
    const seo = { ...validSeo, chapters: [{ timestamp: "00:00", title: "Intro" }, { timestamp: "01:10", title: "Suite" }] } as Seo;
    expect(seoToText(seo)).toBe(`${validSeo.description}\n\n00:00 Intro\n01:10 Suite\n\n#pyramides #histoire`);
  });

  it("SEO sans chapitres calculés : ni ligne vide en trop, ni chapitres", () => {
    expect(seoToText({ ...validSeo, hashtags: [] } as Seo)).toBe(validSeo.description);
  });

  it("tags séparés par des virgules, le format du champ YouTube Studio", () => {
    expect(tagsToText(validSeo as Seo)).toBe("pyramides, égypte ancienne, gizeh");
  });

  it("voix off : profil de voix puis un bloc par segment", () => {
    const text = voiceoverToText(validVoiceover as Voiceover, tFr);
    expect(text).toContain("Voix : male, 40-50, français standard. Narrateur grave et posé");
    expect(text).toContain("Scène 1 · rythme lent · mystère");
    expect(text).toContain("Prononciation : Gizeh → gi-zè");
    expect(text).toContain("Indications : Voix grave, chuchotée au début");
  });

  it("miniatures : chaque concept rappelle le titre associé", () => {
    const text = thumbnailsToText(validThumbnails as Thumbnails, titles, tFr);
    expect(text).toContain("Concept 1 · pour « Le secret des pyramides enfin révélé »");
    expect(text).toContain("Texte : LA RAMPE CACHÉE (top-left, #FFD400 sur contour #000000, bold-sans)");
    expect(text).toContain("Prompt négatif : texte, filigrane, flou");
  });

  it("en anglais : mêmes blocs, libellés traduits", () => {
    expect(scriptToText(script, tEn)).toContain("[00:00 · Hook] 1. Le bloc impossible");
    expect(titlesToText(titles, tEn).split("\n")[0]).toBe("1. Le secret des pyramides enfin révélé (recommended)");
  });

  it("miniatures sans titres disponibles : concept sans rappel de titre", () => {
    expect(thumbnailsToText(validThumbnails as Thumbnails, null, tFr)).toContain("Concept 1\n");
  });
});
