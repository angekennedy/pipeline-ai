import { describe, expect, it } from "vitest";
import type { Brief } from "@/lib/ai/schemas";
import { assetCredits, pipelineCredits, videoCredits } from "@/lib/billing/costs";
import { validBrief } from "../../fixtures/assets";

const brief = (durationMinutes: number, options: { video?: boolean; thumbnailImages?: boolean } = {}) => ({ ...validBrief, durationMinutes, ...options }) as Brief;

describe("coût en crédits", () => {
  it("donne 21 crédits pour un pipeline standard de 10 min (ARCHITECTURE §5.1)", () => {
    expect(assetCredits(brief(10), "standard")).toEqual({ script: 14, titles: 1, seo: 2, voiceover: 3, thumbnails: 1 });
    expect(pipelineCredits(brief(10), "standard")).toBe(21);
  });

  it("facture le script Premium plus cher, les dérivés au même prix", () => {
    expect(assetCredits(brief(10), "premium")).toMatchObject({ script: 8 + 2 * 10, titles: 1, seo: 2, voiceover: 3 });
    expect(pipelineCredits(brief(10), "premium")).toBe(28 + 1 + 2 + 3 + 1);
  });

  it("indexe le script et la voix off sur la durée", () => {
    expect(pipelineCredits(brief(1), "standard")).toBe(5 + 1 + 2 + 2 + 1);
    expect(assetCredits(brief(25), "standard")).toMatchObject({ script: 29, voiceover: 4 });
  });

  it("facture 15 crédits les miniatures en images HD des plans payants", () => {
    expect(assetCredits(brief(10, { thumbnailImages: true }), "standard").thumbnails).toBe(15);
    expect(pipelineCredits(brief(10, { thumbnailImages: true }), "standard")).toBe(35);
  });

  it("ajoute 60 crédits par minute quand le brief demande la vidéo", () => {
    expect(videoCredits(brief(10))).toBe(0);
    expect(videoCredits(brief(10, { video: true }))).toBe(600);
    expect(pipelineCredits(brief(10, { video: true, thumbnailImages: true }), "standard")).toBe(35 + 600);
    expect(pipelineCredits(brief(60, { video: true }), "premium")).toBe(pipelineCredits(brief(60), "premium") + 3600);
  });
});
