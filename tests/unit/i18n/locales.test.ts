import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLocale, localeFromAcceptLanguage, pickLocale } from "@/i18n/locales";

describe("langue de l'interface", () => {
  it("reconnaît le français et l'anglais, rien d'autre", () => {
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it("suit l'ordre de préférence du navigateur, poids compris", () => {
    expect(localeFromAcceptLanguage("en-US,en;q=0.9,fr;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage("de-DE,de;q=0.9,fr;q=0.5,en;q=0.7")).toBe("en");
    expect(localeFromAcceptLanguage("fr;q=0.4, en;q=0.4")).toBe("fr"); // à poids égal, l'ordre d'écriture
    expect(localeFromAcceptLanguage("en;q=0, fr")).toBe("fr"); // q=0 : refusée
    expect(localeFromAcceptLanguage("de, es")).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });

  it("préfère le cookie du sélecteur, puis le navigateur, puis le français", () => {
    expect(pickLocale("en", "fr-FR")).toBe("en");
    expect(pickLocale("xx", "en-GB")).toBe("en");
    expect(pickLocale(undefined, "de-DE")).toBe("fr");
    expect(pickLocale(null, null)).toBe("fr");
  });
});

const setCookie = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set: setCookie }) }));
const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));
let user: { id: string; email: string } | null;
vi.mock("@/lib/auth/session", () => ({ getUser: async () => user }));
const updates: Array<{ values: unknown; id: string }> = [];
let updateError: { message: string } | null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ update: (values: unknown) => ({ eq: async (_: string, id: string) => (updates.push({ values, id }), { error: updateError }) }) }),
  }),
}));

const { changeLocale } = await import("@/i18n/actions");
const form = (locale: string) => {
  const data = new FormData();
  data.set("locale", locale);
  return data;
};

describe("changeLocale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
    user = null;
    updateError = null;
  });

  it("pose le cookie pour un an et rafraîchit la page", async () => {
    await changeLocale(form("en"));
    expect(setCookie).toHaveBeenCalledWith("locale", "en", { path: "/", maxAge: 31_536_000, sameSite: "lax" });
    expect(updates).toEqual([]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("garde la langue dans le profil de l'utilisateur connecté", async () => {
    user = { id: "user-1", email: "ada@test.local" };
    await changeLocale(form("fr"));
    expect(updates).toEqual([{ values: { locale: "fr" }, id: "user-1" }]);
    updateError = { message: "RLS" };
    await expect(changeLocale(form("en"))).rejects.toThrow("Langue du profil user-1 : RLS");
  });

  it("refuse une langue inconnue, sans rien écrire", async () => {
    await expect(changeLocale(form("de"))).rejects.toThrow("Langue inconnue");
    expect(setCookie).not.toHaveBeenCalled();
  });
});
