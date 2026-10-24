import { describe, expect, it } from "vitest";
import { BriefSchema } from "@/lib/ai/schemas/brief";
import { validBrief } from "../../fixtures/assets";

const brief = (overrides: Record<string, unknown> = {}) => ({ ...validBrief, ...overrides });

describe("BriefSchema", () => {
  it("accepte un brief valide et supprime les espaces superflus", () => {
    const parsed = BriefSchema.parse(brief({ niche: "  Histoire  " }));
    expect(parsed.niche).toBe("Histoire");
  });

  it("accepte les champs optionnels", () => {
    const parsed = BriefSchema.parse(
      brief({ targetAudience: "Passionnés d'histoire", extraNotes: "Pas de théorie extraterrestre", channelId: "4b1e1c6e-8a39-4f6e-9a1e-2f1c3d4b5a6c" }),
    );
    expect(parsed.channelId).toBeDefined();
  });

  it.each([
    ["niche trop courte", { niche: "A" }],
    ["niche trop longue", { niche: "x".repeat(81) }],
    ["sujet trop court", { topic: "abc" }],
    ["sujet trop long", { topic: "x".repeat(301) }],
    ["langue hors liste", { language: "jp" }],
    ["ton inconnu", { tone: "angry" }],
    ["style inconnu", { style: "vlog" }],
    ["durée nulle", { durationMinutes: 0 }],
    ["durée trop longue", { durationMinutes: 61 }],
    ["durée non entière", { durationMinutes: 7.5 }],
    ["notes trop longues", { extraNotes: "x".repeat(2001) }],
    ["channelId non UUID", { channelId: "chaine-1" }],
  ])("rejette : %s", (_, overrides) => {
    expect(BriefSchema.safeParse(brief(overrides)).success).toBe(false);
  });

  it("refuse un sujet composé uniquement d'espaces", () => {
    expect(BriefSchema.safeParse(brief({ topic: "        " })).success).toBe(false);
  });
});
