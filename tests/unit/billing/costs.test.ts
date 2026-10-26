import { describe, expect, it } from "vitest";
import type { Brief } from "@/lib/ai/schemas";
import { assetCredits, pipelineCredits } from "@/lib/billing/costs";
import { validBrief } from "../../fixtures/assets";

const brief = (durationMinutes: number) => ({ ...validBrief, durationMinutes }) as Brief;

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
});
