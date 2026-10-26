import { History, TriangleAlert } from "lucide-react";
import type { AssetType } from "@/lib/ai/schemas";
import { VERSION_SOURCE_LABELS } from "@/lib/pipeline/labels";
import type { VersionSummary } from "@/lib/pipeline/view";
import { RegenerateButton, RestoreButton } from "./pipeline-actions";

// Fuseau explicite : le rendu serveur et l'hydratation produisent le même texte.
const dateTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

const STALE_BECAUSE: Partial<Record<AssetType, string>> = {
  thumbnails: "le script ou les titres ont changé depuis",
};

export function StaleNotice({ type, credits }: { type: AssetType; credits: number }) {
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <TriangleAlert aria-hidden="true" className="size-4 text-amber-600" />
      <p className="flex-1">
        <span className="font-medium">Obsolète :</span> cet asset a été produit à partir d&apos;une version précédente,{" "}
        {STALE_BECAUSE[type] ?? "le script a changé depuis"}.
      </p>
      <RegenerateButton types={[type]} credits={credits} />
    </div>
  );
}

export function VersionHistory({ type, versions }: { type: AssetType; versions: VersionSummary[] }) {
  if (versions.length < 2) return null; // une seule version : rien à restaurer
  return (
    <details className="mb-4 rounded-xl border p-3 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-medium">
        <History aria-hidden="true" className="size-4" />
        Historique · {versions.length} versions
      </summary>
      <ol className="mt-3 grid gap-2">
        {versions.map((version, i) => (
          <li key={version.id} className="flex flex-wrap items-center gap-2">
            <span className="font-mono">v{version.version}</span>
            <span>{VERSION_SOURCE_LABELS[version.source]}</span>
            <time dateTime={version.createdAt} className="text-muted-foreground">
              {dateTime.format(new Date(version.createdAt))}
            </time>
            {i === 0 ? (
              <span className="text-muted-foreground">(version actuelle)</span>
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
  const count = types.length;
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <p className="flex-1">
        Le script a changé : {count} {count > 1 ? "assets sont obsolètes" : "asset est obsolète"}.
      </p>
      <RegenerateButton types={types} credits={credits} label="Régénérer les dérivés" variant="default" />
    </div>
  );
}
