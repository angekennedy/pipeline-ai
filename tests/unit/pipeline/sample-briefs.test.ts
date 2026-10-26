import { describe, expect, it } from "vitest";
import { pipelineCredits } from "@/lib/billing/costs";
import { PLANS } from "@/lib/billing/plans";
import { parseBriefForm } from "@/lib/pipeline/brief-form";
import { SAMPLE_BRIEF_KEYS, isSampleBrief, sampleBriefValues } from "@/lib/pipeline/sample-briefs";
import { flaggedCategories } from "@/lib/security/moderation";
import { tEn, tFr } from "../../fixtures/i18n";

// Briefs d'exemple de l'onboarding (tâche 5.4), dans les deux langues de l'interface.
const sample = (key: (typeof SAMPLE_BRIEF_KEYS)[number], locale: "fr" | "en") => {
  const t = locale === "fr" ? tFr : tEn;
  return sampleBriefValues(key, { niche: t(`Onboarding.samples.${key}.niche`), topic: t(`Onboarding.samples.${key}.topic`) }, locale);
};
const form = (values: Record<string, string | undefined>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) data.set(key, value);
  return data;
};

describe("briefs d'exemple", () => {
  it.each(SAMPLE_BRIEF_KEYS.flatMap((key) => (["fr", "en"] as const).map((locale) => [key, locale] as const)))(
    "%s (%s) : brief valide, dans la langue de l'interface, sans mot-clé de modération",
    (key, locale) => {
      const result = parseBriefForm(form(sample(key, locale)));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.brief).toMatchObject({ language: locale, durationMinutes: 3 });
      expect(result.tier).toBe("standard");
      // Aucun appel de modération payant pour un exemple, et aucun refus possible.
      expect(flaggedCategories(result.brief)).toEqual([]);
    },
  );

  it("tient plusieurs fois dans les crédits offerts du plan Free", () => {
    const credits = pipelineCredits({ durationMinutes: 3 }, "standard");
    expect(credits * 2).toBeLessThanOrEqual(PLANS.free.credits);
  });

  it("remplace toute saisie précédente, preset de chaîne compris", () => {
    expect(sample("vikings", "fr")).toMatchObject({ targetAudience: "", extraNotes: "", channelId: "" });
  });

  it("ne reconnaît que les exemples définis", () => {
    expect(isSampleBrief("vikings")).toBe(true);
    expect(isSampleBrief("toString")).toBe(false); // propriété héritée, pas un exemple
    expect(isSampleBrief(undefined)).toBe(false);
  });
});
