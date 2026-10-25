import { ASSET_TYPES, type AssetType, type Brief } from "@/lib/ai/schemas";
import type { PipelineLiveState } from "@/lib/realtime/pipeline-state";
import type { AssetContent, ModelTier } from "./registry";
import type { PipelineStatus } from "./status";
import type { VersionSource } from "./store";

// Pipeline tel que la page le lit en base : version courante de chaque asset, ou son état.

export type AssetViewStatus = "pending" | "running" | "ready" | "failed" | "skipped";

export type VersionSummary = { id: string; version: number; source: VersionSource; createdAt: string };

export type AssetView<K extends AssetType> = {
  status: AssetViewStatus;
  content: AssetContent[K] | null; // renseigné quand status = ready
  error: { code: string; message: string } | null; // renseigné quand status = failed
  stale: boolean; // produit à partir d'une version précédente d'une dépendance (staleness.ts)
  versions: VersionSummary[]; // historique, la plus récente (courante) d'abord
};

export type PipelineAssets = { [K in AssetType]: AssetView<K> };

export type PipelineView = {
  id: string;
  brief: Brief;
  tier: ModelTier;
  status: PipelineStatus;
  createdAt: string; // ISO 8601
  assets: PipelineAssets;
  staleCredits: number; // coût de « Régénérer les dérivés » obsolètes, 0 s'il n'y en a pas
};

const mapAssets = (fn: (type: AssetType) => AssetView<AssetType>) =>
  Object.fromEntries(ASSET_TYPES.map((type) => [type, fn(type)])) as PipelineAssets;

export function emptyPipelineView(pipeline: Pick<PipelineView, "id" | "brief" | "tier" | "createdAt">): PipelineView {
  return {
    ...pipeline,
    status: "queued",
    staleCredits: 0,
    assets: mapAssets(() => ({ status: "pending", content: null, error: null, stale: false, versions: [] })),
  };
}

const SETTLED: ReadonlySet<AssetViewStatus> = new Set(["ready", "failed", "skipped"]);
const FINAL: ReadonlySet<PipelineStatus> = new Set(["completed", "partial", "failed", "canceled"]);

// Superpose l'état reçu en direct à la vue lue en base. La base l'emporte dès qu'elle a tranché :
// un asset terminé, en échec ou sauté, un pipeline au statut final. Un asset annoncé prêt en direct
// reste « en cours » tant que la page n'a pas relu son contenu (router.refresh).
export function mergeLiveState(view: PipelineView, live: PipelineLiveState): PipelineView {
  return {
    ...view,
    status: FINAL.has(view.status) ? view.status : (live.status ?? view.status),
    assets: mapAssets((type) => {
      const stored = view.assets[type];
      const liveStatus = live.assets[type];
      if (SETTLED.has(stored.status) || !liveStatus) return stored;
      return { ...stored, status: liveStatus === "ready" ? "running" : liveStatus };
    }),
  };
}

// Mode démo : équivalent d'une relecture en base pour un asset, à partir de la vue finale.
export function revealAsset(view: PipelineView, final: PipelineView, type: AssetType): PipelineView {
  return { ...view, assets: { ...view.assets, [type]: final.assets[type] } };
}
