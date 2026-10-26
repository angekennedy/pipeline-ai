import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import type { ExportFormat } from "@/lib/export/document";

// Téléchargements d'un pipeline (route /api/pipelines/[id]/export), avec le rappel de déclaration du
// contenu IA, repris dans chaque fichier.
const FORMATS: ExportFormat[] = ["zip", "txt", "srt", "md", "json"];

export function ExportMenu({ pipelineId }: { pipelineId: string }) {
  const t = useTranslations("ExportMenu");
  return (
    <section aria-labelledby="exports" className="grid gap-3 rounded-xl border p-4">
      <h2 id="exports" className="font-semibold">
        {t("title")}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {FORMATS.map((format) => (
          <li key={format}>
            <a
              href={`/api/pipelines/${pipelineId}/export?format=${format}`}
              download
              title={t(`${format}.hint`)}
              className={buttonVariants({ variant: format === "zip" ? "default" : "outline", size: "sm" })}
            >
              <Download aria-hidden="true" />
              {t(`${format}.label`)}
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("disclosure")}</p>
    </section>
  );
}
