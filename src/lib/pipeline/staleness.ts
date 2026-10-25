import { ASSET_TYPES, type AssetType, type Brief } from "@/lib/ai/schemas";
import { registry, type ModelTier } from "./registry";
import type { PipelineStore, StoredVersion } from "./store";

// Obsolescence calculée, jamais stockée : un asset est obsolète quand une de ses dépendances a
// changé de version depuis qu'il a été produit, ou qu'elle est elle-même obsolète. Régénérer ou
// éditer le script rend donc obsolètes tous les dérivés ; régénérer les titres, les miniatures.

export type VersionRef = Pick<StoredVersion, "id" | "sourceVersions" | "restoredFrom">;
export type CurrentVersions = Partial<Record<AssetType, VersionRef | null>>;

const origin = (version: VersionRef) => version.restoredFrom ?? version.id;

export function staleAssets(current: CurrentVersions): AssetType[] {
  const stale = new Set<AssetType>();
  // ASSET_TYPES suit l'ordre du DAG : une dépendance est évaluée avant ses dépendants.
  for (const type of ASSET_TYPES) {
    const version = current[type];
    if (!version) continue; // pas encore généré : à générer, pas obsolète
    const outdated = registry[type].dependsOn.some((dep) => {
      const dependency = current[dep];
      return stale.has(dep) || !dependency || version.sourceVersions[dep] !== origin(dependency);
    });
    if (outdated) stale.add(type);
  }
  return ASSET_TYPES.filter((type) => stale.has(type));
}

export async function staleAssetsOf(store: PipelineStore, pipelineId: string): Promise<AssetType[]> {
  const versions = await Promise.all(ASSET_TYPES.map((type) => store.getCurrentVersion(pipelineId, type)));
  return staleAssets(Object.fromEntries(ASSET_TYPES.map((type, i) => [type, versions[i]])));
}

// Coût affiché avant de lancer « Régénérer les dérivés » : même tarif qu'une première génération.
export const regenerationCredits = (types: AssetType[], brief: Brief, tier: ModelTier) =>
  types.reduce((total, type) => total + registry[type].credits(brief, tier), 0);
