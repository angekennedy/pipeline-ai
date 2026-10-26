import { describe, expect, it } from "vitest";
import { briefToFormValues, parseBriefForm } from "@/lib/pipeline/brief-form";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const valid = {
  niche: "Histoire",
  topic: "Comment les pyramides ont été construites",
  language: "fr",
  tone: "mysterious",
  style: "documentary",
  durationMinutes: "8",
  targetAudience: "",
  extraNotes: "",
  tier: "standard",
};

describe("parseBriefForm", () => {
  it("convertit les champs du formulaire en brief validé", () => {
    expect(parseBriefForm(form(valid))).toEqual({
      ok: true,
      tier: "standard",
      brief: {
        niche: "Histoire",
        topic: "Comment les pyramides ont été construites",
        language: "fr",
        tone: "mysterious",
        style: "documentary",
        durationMinutes: 8,
      },
      values: valid,
    });
  });

  it("garde les champs optionnels remplis et la formule Premium", () => {
    const result = parseBriefForm(form({ ...valid, targetAudience: "  Lycéens ", extraNotes: "Pas de théorie extraterrestre", tier: "premium" }));
    expect(result).toMatchObject({ ok: true, tier: "premium", brief: { targetAudience: "Lycéens", extraNotes: "Pas de théorie extraterrestre" } });
  });

  it("utilise la formule standard par défaut", () => {
    const data = form(valid);
    data.delete("tier");
    expect(parseBriefForm(data)).toMatchObject({ ok: true, tier: "standard" });
  });

  it("renvoie un message clair par champ invalide, et les valeurs saisies pour réafficher le formulaire", () => {
    const result = parseBriefForm(form({ ...valid, niche: "H", durationMinutes: "90", language: "jp" }));
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        niche: true,
        durationMinutes: true,
        language: true,
      },
      values: { ...valid, niche: "H", durationMinutes: "90", language: "jp" },
    });
  });

  it.each([
    ["durée non numérique", { durationMinutes: "huit" }, "durationMinutes"],
    ["durée décimale", { durationMinutes: "7.5" }, "durationMinutes"],
    ["sujet vide", { topic: "   " }, "topic"],
    ["formule inconnue", { tier: "gold" }, "tier"],
    ["notes trop longues", { extraNotes: "x".repeat(2001) }, "extraNotes"],
  ])("rejette : %s", (_, overrides, field) => {
    const result = parseBriefForm(form({ ...valid, ...overrides }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && Object.keys(result.fieldErrors)).toEqual([field]);
  });

  it("ne renvoie pas de champ inattendu dans les valeurs", () => {
    const result = parseBriefForm(form({ ...valid, niche: "", injected: "x" }));
    expect(result.ok === false && result.values).not.toHaveProperty("injected");
  });

  it("garde le preset choisi, et aucun pour « Aucun preset »", () => {
    const channelId = "4d1f7c3e-2b6a-4f8e-9c0d-1a2b3c4d5e6f";
    expect(parseBriefForm(form({ ...valid, channelId }))).toMatchObject({ ok: true, brief: { channelId } });
    const none = parseBriefForm(form({ ...valid, channelId: "" }));
    expect(none.ok && none.brief.channelId).toBeUndefined();
    expect(parseBriefForm(form({ ...valid, channelId: "pas-un-uuid" }))).toMatchObject({ ok: false, fieldErrors: { channelId: true } });
  });

  it("relit sans perte un brief remis en formulaire (duplication)", () => {
    const parsed = parseBriefForm(form({ ...valid, targetAudience: "Curieux", tier: "premium" }));
    if (!parsed.ok) throw new Error("brief invalide");
    const values = briefToFormValues(parsed.brief, parsed.tier);
    expect(values).toEqual({ ...valid, targetAudience: "Curieux", tier: "premium", channelId: "" });
    expect(parseBriefForm(form(values as Record<string, string>))).toMatchObject({ ok: true, brief: parsed.brief, tier: "premium" });
  });
});
