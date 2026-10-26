import { describe, expect, it } from "vitest";
import { briefPrefill, channelOption, parseChannelForm, presetToFormValues } from "@/lib/channels/form";
import { validChannel } from "../../fixtures/assets";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const full = {
  name: "Mystères d'Égypte",
  niche: "Histoire",
  defaultLanguage: "fr",
  tone: "mysterious",
  style: "documentary",
  audience: "Passionnés d'histoire de 25 à 45 ans",
  voiceGender: "male",
  voiceAge: "40-50",
  voiceAccent: "français standard",
  voicePace: "slow",
  bannedWords: "extraterrestre",
  ctaTemplate: "Abonnez-vous pour le prochain mystère.",
  thumbnailPalette: "#FFD400, #000000",
};

describe("parseChannelForm", () => {
  it("convertit les champs du formulaire en preset validé", () => {
    expect(parseChannelForm(form(full))).toEqual({ ok: true, preset: validChannel, values: full });
  });

  it("accepte un preset minimal : les champs vides sont omis", () => {
    const minimal = { ...Object.fromEntries(Object.keys(full).map((key) => [key, ""])), name: "Mystères", niche: "Histoire", defaultLanguage: "fr" };
    expect(parseChannelForm(form(minimal))).toMatchObject({
      ok: true,
      preset: { name: "Mystères", niche: "Histoire", defaultLanguage: "fr", voiceProfile: {}, brandRules: { bannedWords: [], thumbnailPalette: [] } },
    });
  });

  it("découpe les listes sur les virgules et les retours à la ligne, sans doublon, couleurs en majuscules", () => {
    const result = parseChannelForm(form({ ...full, bannedWords: "secret, choc\nsecret,, incroyable ", thumbnailPalette: "#ffd400,#000000" }));
    expect(result.ok && result.preset.brandRules).toMatchObject({ bannedWords: ["secret", "choc", "incroyable"], thumbnailPalette: ["#FFD400", "#000000"] });
  });

  it.each([
    ["nom vide", { name: "" }, "name"],
    ["langue hors liste", { defaultLanguage: "jp" }, "defaultLanguage"],
    ["rythme inconnu", { voicePace: "turbo" }, "voicePace"],
    ["âge trop long", { voiceAge: "x".repeat(21) }, "voiceAge"],
    ["mot interdit trop long", { bannedWords: "x".repeat(41) }, "bannedWords"],
    ["couleur invalide", { thumbnailPalette: "rouge" }, "thumbnailPalette"],
  ])("rejette : %s, sur le bon champ", (_, overrides, field) => {
    const result = parseChannelForm(form({ ...full, ...overrides }));
    expect(result).toMatchObject({ ok: false, fieldErrors: { [field]: true } });
    expect(result.ok === false && Object.keys(result.fieldErrors)).toEqual([field]);
  });
});

describe("presetToFormValues", () => {
  it("relit sans perte un preset remis en formulaire", () => {
    const values = presetToFormValues(validChannel as never);
    expect(values).toEqual(full);
    expect(parseChannelForm(form(values as Record<string, string>))).toMatchObject({ ok: true, preset: validChannel });
  });
});

describe("briefPrefill", () => {
  it("préremplit la niche, la langue, le ton, le style et le public du brief", () => {
    expect(briefPrefill(channelOption({ id: "c1", preset: validChannel as never }))).toEqual({
      niche: "Histoire",
      language: "fr",
      tone: "mysterious",
      style: "documentary",
      targetAudience: "Passionnés d'histoire de 25 à 45 ans",
    });
  });

  it("laisse la saisie en cours pour ce que le preset ne fixe pas", () => {
    expect(briefPrefill({ id: "c1", name: "Sciences", niche: "Science", defaultLanguage: "en" })).toEqual({ niche: "Science", language: "en" });
  });
});
