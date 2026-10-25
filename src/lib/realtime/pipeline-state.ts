import type { AssetType } from "@/lib/ai/schemas";
import type { Scene } from "@/lib/ai/schemas/script";
import type { PipelineStatus } from "@/lib/pipeline/status";
import type { PipelineEvent } from "./events";

// État affiché en direct par le navigateur, reconstruit à partir des événements Broadcast.
// Provisoire : la page relit la base (router.refresh) à chaque étape terminée.

export type LiveAssetStatus = "running" | "ready" | "failed";

export type PipelineLiveState = {
  status: PipelineStatus | null; // dernier statut connu, lu en base au rendu de la page
  assets: Partial<Record<AssetType, LiveAssetStatus>>;
  scenes: Scene[]; // scènes du script reçues pendant la génération, triées par index
};

export const initialLiveState = (status: PipelineStatus | null = null): PipelineLiveState => ({ status, assets: {}, scenes: [] });

function mergeScenes(current: Scene[], incoming: Scene[]): Scene[] {
  const byIndex = new Map(current.map((scene) => [scene.index, scene]));
  for (const scene of incoming) byIndex.set(scene.index, scene);
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

export function applyPipelineEvent(state: PipelineLiveState, event: PipelineEvent): PipelineLiveState {
  switch (event.type) {
    case "asset.started":
      return {
        ...state,
        assets: { ...state.assets, [event.asset]: "running" },
        // Un script qui (re)démarre remplace l'ancien : ses scènes ne valent plus.
        scenes: event.asset === "script" ? [] : state.scenes,
      };
    case "asset.partial":
      return { ...state, scenes: mergeScenes(state.scenes, event.scenes) };
    case "asset.completed":
      return { ...state, assets: { ...state.assets, [event.asset]: "ready" } };
    case "asset.failed":
      return { ...state, assets: { ...state.assets, [event.asset]: "failed" } };
    case "pipeline.status":
      return { ...state, status: event.status };
  }
}

// Événements après lesquels la base a changé : la page relit l'état (Server Components).
export const refreshesPage = (event: PipelineEvent) =>
  event.type === "asset.completed" || event.type === "asset.failed" || event.type === "pipeline.status";
