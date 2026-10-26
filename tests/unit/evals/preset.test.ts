import { describe, expect, it } from "vitest";
import { evalPreset, pickBannedWords, summarize, titlesWithBannedWords } from "../../../evals/lib/preset";
import { ChannelPresetSchema, type Brief } from "@/lib/ai/schemas";
import { validBrief } from "../../fixtures/assets";

const brief = { ...validBrief, topic: "Le mystère des pyramides de Gizeh", niche: "Histoire" } as Brief;

describe("pickBannedWords", () => {
  it("prend les mots les plus fréquents, présents dans deux titres au moins, hors sujet et niche", () => {
    const titles = [
      "Le secret oublié des bâtisseurs de Gizeh",
      "Pyramides : le SECRET enfin révélé",
      "Ce que les bâtisseurs savaient vraiment",
      "Les bâtisseurs et leur secret oublié",
      "Mystère des pyramides : la rampe cachée",
    ];
    // « pyramides » et « mystère » viennent du sujet ; « rampe » n'apparaît qu'une fois.
    expect(pickBannedWords(titles, brief)).toEqual(["batisseurs", "secret", "oublie"]);
  });

  it("ignore les mots courts et peut n'en trouver aucun", () => {
    expect(pickBannedWords(["Le jour où tout a changé", "Le jour du choix"], brief)).toEqual([]);
  });
});

describe("titlesWithBannedWords", () => {
  it("compte les titres qui emploient un mot interdit, en mot entier, sans accents ni casse", () => {
    const titles = ["Le SECRET des bâtisseurs", "Les secrets du Nil", "Une batisseuse oubliée", "Rien à voir"];
    expect(titlesWithBannedWords(titles, ["secret", "bâtisseurs"])).toBe(1);
    expect(titlesWithBannedWords(titles, ["batisseuse", "secrets"])).toBe(2);
  });
});

describe("evalPreset", () => {
  it("donne un preset valide qui ne fixe que les mots interdits", () => {
    const preset = evalPreset(brief, ["secret"]);
    expect(ChannelPresetSchema.parse(preset)).toEqual(preset);
    expect(preset).toMatchObject({ niche: "Histoire", defaultLanguage: brief.language, brandRules: { bannedWords: ["secret"] } });
    expect(preset).not.toHaveProperty("tone");
  });
});

describe("summarize", () => {
  it("compare le taux de titres fautifs, témoin contre preset, sur tous les cas", () => {
    expect(
      summarize([
        { id: "a", banned: ["x"], control: { titles: 8, withBanned: 4 }, preset: { titles: 8, withBanned: 0 } },
        { id: "b", banned: ["y"], control: { titles: 2, withBanned: 1 }, preset: { titles: 2, withBanned: 1 } },
      ]),
    ).toEqual({ cases: 2, controlRate: 0.5, presetRate: 0.1 });
    expect(summarize([])).toEqual({ cases: 0, controlRate: 0, presetRate: 0 });
  });
});
