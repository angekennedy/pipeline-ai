import { History, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { AssetType } from "@/lib/ai/schemas";
import type { VersionSummary } from "@/lib/pipeline/view";
import { RegenerateButton, RestoreButton } from "./pipeline-actions";

// Fuseau explicite : le rendu serveur et l'hydratation produisent le même texte.
const DATE_TIME = { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" } as const;

export function StaleNotice({ type, credits }: { type: AssetType; credits: number }) {
  const t = useTranslations("AssetHistory");
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <TriangleAlert aria-hidden="true" className="size-4 text-amber-600" />
      <p className="flex-1">
        <span className="font-medium">{t("staleLabel")}</span> {type === "thumbnails" ? t("staleThumbnails") : t("staleScript")}
      </p>
      <RegenerateButton types={[type]} credits={credits} />
    </div>
  );
}

export function VersionHistory({ type, versions }: { type: AssetType; versions: VersionSummary[] }) {
  const t = useTranslations("AssetHistory");
  const labels = useTranslations("Labels");
  const format = useFormatter();
  if (versions.length < 2) return null; // une seule version : rien à restaurer
  return (
    <details className="mb-4 rounded-xl border p-3 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-medium">
        <History aria-hidden="true" className="size-4" />
        {t("history", { count: versions.length })}
      </summary>
      <ol className="mt-3 grid gap-2">
        {versions.map((version, i) => (
          <li key={version.id} className="flex flex-wrap items-center gap-2">
            <span className="font-mono">v{version.version}</span>
            <span>{labels(`versionSource.${version.source}`)}</span>
            <time dateTime={version.createdAt} className="text-muted-foreground">
              {format.dateTime(new Date(version.createdAt), DATE_TIME)}
            </time>
            {i === 0 ? (
              <span className="text-muted-foreground">{t("current")}</span>
            ) : (
              <RestoreButton type={type} versionId={version.id} />
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

// Régénère d'un coup les assets obsolètes, dans l'ordre du DAG : les miniatures partent des titres
// régénérés.
export function StaleBanner({ types, credits }: { types: AssetType[]; credits: number }) {
  const t = useTranslations("AssetHistory");
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <p className="flex-1">
        {t("banner", { count: types.length })}
      </p>
      <RegenerateButton types={types} credits={credits} label={t("regenerateDerived")} variant="default" />
    </div>
  );
}
