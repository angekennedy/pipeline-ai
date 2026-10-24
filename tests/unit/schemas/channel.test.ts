import { describe, expect, it } from "vitest";
import { ChannelPresetSchema } from "@/lib/ai/schemas/channel";
import { validChannel } from "../../fixtures/assets";

const channel = (overrides: Record<string, unknown> = {}) => ({ ...validChannel, ...overrides });

describe("ChannelPresetSchema", () => {
  it("accepte un preset complet", () => {
    expect(ChannelPresetSchema.parse(validChannel)).toEqual(validChannel);
  });

  it("accepte un preset minimal et remplit les règles de marque par défaut", () => {
    const parsed = ChannelPresetSchema.parse({ name: "Mystères", niche: "Histoire", defaultLanguage: "fr" });
    expect(parsed.voiceProfile).toEqual({});
    expect(parsed.brandRules).toEqual({ bannedWords: [], thumbnailPalette: [] });
  });

  it.each([
    ["nom vide", { name: "" }],
    ["langue hors liste", { defaultLanguage: "jp" }],
    ["ton inconnu", { tone: "angry" }],
    ["public trop long", { audience: "x".repeat(201) }],
    ["trop de mots interdits", { brandRules: { bannedWords: Array(51).fill("mot"), thumbnailPalette: [] } }],
    ["couleur invalide", { brandRules: { bannedWords: [], thumbnailPalette: ["rouge"] } }],
    ["CTA trop long", { brandRules: { bannedWords: [], thumbnailPalette: [], ctaTemplate: "x".repeat(301) } }],
    ["rythme inconnu", { voiceProfile: { pace: "turbo" } }],
  ])("rejette : %s", (_, overrides) => {
    expect(ChannelPresetSchema.safeParse(channel(overrides)).success).toBe(false);
  });
});
