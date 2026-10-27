import { getFormatter, getTranslations } from "next-intl/server";
import { DATE } from "@/i18n/format";
import { HOST, LEGAL_ENTITY, isLegalComplete, type LegalEntity, type LegalPage } from "@/lib/legal";

// Date de la version en vigueur des documents légaux.
export const LEGAL_UPDATED = "2026-10-27";

type Section = { title: string; body: string };

// Un paragraphe par bloc séparé d'une ligne vide ; un bloc dont toutes les lignes commencent par
// « - » devient une liste. Texte seulement : aucun HTML n'est interprété.
function Body({ text }: { text: string }) {
  return text.split("\n\n").map((block, index) => {
    const lines = block.split("\n");
    if (lines.every((line) => line.startsWith("- "))) {
      return (
        <ul key={index} className="list-disc space-y-1 pl-5">
          {lines.map((line) => (
            <li key={line}>{line.slice(2)}</li>
          ))}
        </ul>
      );
    }
    return <p key={index}>{block}</p>;
  });
}

// Documents légaux (tâche 5.2) : texte dans messages/*.json (Legal.<page>), identité de l'éditeur
// dans src/lib/legal.ts. Un champ non renseigné s'affiche « [à compléter : …] », avec un bandeau.
export async function LegalDocument({ page, entity = LEGAL_ENTITY }: { page: LegalPage; entity?: LegalEntity }) {
  const [t, format] = await Promise.all([getTranslations("Legal"), getFormatter()]);
  const values = {
    ...(Object.fromEntries(Object.entries(entity).map(([key, value]) => [key, value || t(`missing.${key as keyof LegalEntity}`)])) as Record<keyof LegalEntity, string>),
    host: HOST,
  };
  // Clés construites à partir du document : hors du typage strict des messages.
  const text = t as unknown as { (key: string, values?: Record<string, string>): string; raw: (key: string) => unknown };
  const sections = Object.keys(text.raw(`${page}.sections`) as Record<string, Section>);

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-8 px-4 py-12">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t(`${page}.title`)}</h1>
        <p className="text-sm text-muted-foreground">{t("updated", { date: format.dateTime(new Date(LEGAL_UPDATED), DATE) })}</p>
        {!isLegalComplete(entity) && (
          <p role="note" className="rounded-xl border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
            {t("draft")}
          </p>
        )}
      </header>
      {sections.length > 2 && (
        <nav aria-label={t("toc")} className="text-sm">
          <ol className="list-decimal space-y-1 pl-5">
            {sections.map((key) => (
              <li key={key}>
                <a href={`#${key}`} className="underline-offset-4 hover:underline">
                  {text(`${page}.sections.${key}.title`)}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      {sections.map((key) => (
        <section key={key} id={key} aria-labelledby={`${key}-title`} className="grid gap-3 leading-relaxed">
          <h2 id={`${key}-title`} className="text-xl font-semibold">
            {text(`${page}.sections.${key}.title`)}
          </h2>
          <Body text={text(`${page}.sections.${key}.body`, values)} />
        </section>
      ))}
    </main>
  );
}
