import { useLocale, useTranslations } from "next-intl";
import { changeLocale } from "@/i18n/actions";
import { LOCALES } from "@/i18n/locales";
import { cn } from "@/lib/utils";

// Choix de la langue de l'interface, dans l'en-tête : un formulaire, utilisable sans JavaScript.
export function LocaleSwitcher() {
  const t = useTranslations("Header");
  const current = useLocale();
  return (
    // Le groupe est porté par un div : un rôle sur le <form> écraserait le sien.
    <form action={changeLocale}>
      <div role="group" aria-label={t("language")} className="flex items-center rounded-md border text-xs">
        {LOCALES.map((locale) => (
          <button
            key={locale}
            type="submit"
            name="locale"
            value={locale}
            lang={locale}
            aria-pressed={locale === current}
            title={t(`languageName.${locale}`)}
            className={cn("px-2 py-0.5 font-medium", locale === current ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {locale.toUpperCase()}
          </button>
        ))}
      </div>
    </form>
  );
}
