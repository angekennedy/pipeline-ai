import { useFormatter, useTranslations } from "next-intl";
import { SHORT_DATE_TIME } from "@/i18n/format";
import type { GenerationError } from "@/lib/admin/generation-errors";

// Tableau des générations en échec avec le message exact (administrateurs seulement).
// `showPipeline` : colonne du pipeline, utile sur /admin, inutile sur la page d'un pipeline.
export function GenerationErrors({ errors, showPipeline = false }: { errors: GenerationError[]; showPipeline?: boolean }) {
  const t = useTranslations("Admin.errors");
  const labels = useTranslations("Labels");
  const format = useFormatter();
  if (errors.length === 0) return <p className="text-sm text-muted-foreground">{t("none")}</p>;

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{t("col.date")}</th>
            {showPipeline && <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{t("col.pipeline")}</th>}
            <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{t("col.asset")}</th>
            <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{t("col.code")}</th>
            <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{t("col.model")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.message")}</th>
          </tr>
        </thead>
        <tbody>
          {errors.map((error) => (
            <tr key={error.id} className="border-t align-top">
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">{format.dateTime(new Date(error.createdAt), SHORT_DATE_TIME)}</td>
              {showPipeline && <td className="px-3 py-2 font-mono text-xs">{error.pipelineId.slice(0, 8)}</td>}
              <td className="px-3 py-2 whitespace-nowrap">{labels(`assets.${error.assetType}`)}</td>
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{error.code ?? t("unknown")}</td>
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                {error.model ?? t("unknown")}
                {error.promptVersion && <span className="block text-muted-foreground">{error.promptVersion}</span>}
                <span className="block text-muted-foreground">{t("attempt", { attempt: error.attempt })}</span>
              </td>
              <td className="px-3 py-2">
                <code className="font-mono text-xs break-all whitespace-pre-wrap">{error.message ?? t("noMessage")}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
