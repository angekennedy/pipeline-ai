import { describe, expect, it } from "vitest";
import type { Seo } from "@/lib/ai/schemas";
import { shortcutFor } from "@/lib/pipeline/shortcuts";
import { YOUTUBE_LIMITS, charLength, counterStatus, seoCounters, titleCounter } from "@/lib/pipeline/youtube-limits";
import { validSeo } from "../../fixtures/assets";

describe("compteurs de YouTube Studio", () => {
  it("compte un emoji ou une lettre accentuée comme un caractère", () => {
    expect(charLength("Égypte 🔺")).toBe(8);
  });

  it("signale un titre tronqué dans le fil, puis au-delà de la limite", () => {
    expect(titleCounter("x".repeat(70))).toEqual({ count: 70, status: "ok" });
    expect(titleCounter("x".repeat(71))).toEqual({ count: 71, status: "warn" });
    expect(titleCounter("x".repeat(101))).toEqual({ count: 101, status: "over" });
    expect(counterStatus(10, { max: 5 })).toBe("over");
  });

  it("donne la longueur de la description, son début visible en recherche, les tags et les hashtags", () => {
    const seo = { ...(validSeo as Seo), description: "é".repeat(200), tags: ["pyramides", "egypte ancienne"], hashtags: ["#a", "#b", "#c"] };
    const counters = seoCounters(seo);
    expect(counters.description).toEqual({ count: 200, status: "ok" });
    expect(charLength(counters.preview)).toBe(YOUTUBE_LIMITS.description.preview);
    expect(counters.tags).toEqual({ count: 9 + 1 + (15 + 2), status: "ok" }); // tag avec espace : guillemets comptés
    expect(counters.hashtags).toEqual({ count: 3, status: "ok" });
    expect(seoCounters({ ...seo, description: "x".repeat(5001) }).description.status).toBe("over");
  });
});

describe("raccourcis clavier", () => {
  it("associe les touches aux onglets et aux actions", () => {
    expect(shortcutFor({ key: "1" })).toEqual({ type: "tab", asset: "script" });
    expect(shortcutFor({ key: "5" })).toEqual({ type: "tab", asset: "thumbnails" });
    expect(shortcutFor({ key: "c" })).toEqual({ type: "copy" });
    expect(shortcutFor({ key: "E" })).toEqual({ type: "edit" });
    expect(shortcutFor({ key: "?" })).toEqual({ type: "help" });
    for (const key of ["6", "0", "x", "Enter"]) expect(shortcutFor({ key }), key).toBeNull();
  });

  it("ignore la saisie dans un champ et les combinaisons avec modificateur", () => {
    for (const tagName of ["INPUT", "textarea", "SELECT"]) expect(shortcutFor({ key: "c", target: { tagName } }), tagName).toBeNull();
    expect(shortcutFor({ key: "c", target: { tagName: "DIV", isContentEditable: true } })).toBeNull();
    expect(shortcutFor({ key: "c", metaKey: true })).toBeNull(); // ⌘C reste la copie du navigateur
    expect(shortcutFor({ key: "1", ctrlKey: true })).toBeNull();
    expect(shortcutFor({ key: "e", altKey: true })).toBeNull();
    expect(shortcutFor({ key: "c", target: { tagName: "BUTTON" } })).toEqual({ type: "copy" });
  });
});
