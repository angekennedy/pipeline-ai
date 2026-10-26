// Langues de l'interface (tâche 4.4), sans préfixe d'URL : la langue vient du cookie posé par le
// sélecteur, sinon de la préférence du navigateur (Accept-Language), sinon le français. Distincte de la
// langue des contenus générés, choisie dans chaque brief.

export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr";
export const LOCALE_COOKIE = "locale";

export const isLocale = (value: string | null | undefined): value is Locale => (LOCALES as readonly string[]).includes(value ?? "");

// Première langue prise en charge dans l'ordre de préférence du navigateur (`fr-FR,fr;q=0.9,en;q=0.8`).
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { language: tag.trim().toLowerCase().split("-")[0], weight: q ? Number(q.trim().slice(2)) : 1, index };
    })
    .filter((entry) => entry.language && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  return ranked.map((entry) => entry.language).find(isLocale) ?? null;
}

export const pickLocale = (cookie: string | null | undefined, acceptLanguage: string | null | undefined): Locale =>
  isLocale(cookie) ? cookie : (localeFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE);
