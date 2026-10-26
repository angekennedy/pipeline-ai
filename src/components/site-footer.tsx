import Link from "next/link";
import { useTranslations } from "next-intl";
import { LEGAL_PAGES, LEGAL_PATHS } from "@/lib/legal";

// Pied de page de toutes les pages (tâche 5.2) : documents légaux.
export function SiteFooter() {
  const t = useTranslations("Legal.footer");
  return (
    <footer className="mt-auto border-t">
      <nav aria-label={t("nav")} className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-6 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Pipeline AI</span>
        {LEGAL_PAGES.map((page) => (
          <Link key={page} href={LEGAL_PATHS[page]} className="hover:text-foreground">
            {t(page)}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
