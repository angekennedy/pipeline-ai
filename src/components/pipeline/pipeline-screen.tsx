"use client";

import { ASSET_TYPES, type Scene } from "@/lib/ai/schemas";
import { useDemoPipeline } from "@/hooks/use-demo-pipeline";
import { usePipelineChannel } from "@/hooks/use-pipeline-channel";
import { PIPELINE_STATUS_LABELS } from "@/lib/pipeline/labels";
import type { PipelineStatus } from "@/lib/pipeline/status";
import { mergeLiveState, type PipelineView } from "@/lib/pipeline/view";
import { Badge } from "@/components/ui/badge";
import { StaleBanner } from "./asset-history";
import { AssetTabs } from "./asset-tabs";

const STATUS_VARIANTS: Record<PipelineStatus, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "outline",
  running: "secondary",
  completed: "default",
  partial: "destructive",
  failed: "destructive",
  canceled: "outline",
};

export function PipelineStatusBadge({ status }: { status: PipelineStatus }) {
  return (
    <span aria-live="polite">
      <Badge variant={STATUS_VARIANTS[status]}>{PIPELINE_STATUS_LABELS[status]}</Badge>
    </span>
  );
}

const STATUS_HINTS: Partial<Record<PipelineStatus, string>> = {
  partial: "Certains assets n'ont pas pu être générés. Les autres sont prêts, et les crédits des assets en échec sont restitués.",
  failed: "Le script n'a pas pu être généré, les autres assets n'ont donc pas été lancés. Les crédits ont été restitués.",
};

function PipelineBody({ view, scenes }: { view: PipelineView; scenes: Scene[] }) {
  const hint = STATUS_HINTS[view.status];
  const staleCount = ASSET_TYPES.filter((type) => view.assets[type].stale).length;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <PipelineStatusBadge status={view.status} />
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {staleCount > 0 && <StaleBanner count={staleCount} credits={view.staleCredits} />}
      <AssetTabs view={view} scenes={scenes} />
    </div>
  );
}

// Pipeline terminé ou relu en base, sans suivi en direct.
export function StaticPipeline({ view }: { view: PipelineView }) {
  return <PipelineBody view={view} scenes={[]} />;
}

// Mode démo : génération rejouée dans le navigateur.
export function DemoReplayPipeline({ view, final }: { view: PipelineView; final: PipelineView }) {
  const replay = useDemoPipeline(view, final);
  return <PipelineBody view={replay.view} scenes={replay.scenes} />;
}

// Pipeline réel en cours : suivi Realtime, la page relue en base à chaque étape terminée.
export function LivePipeline({ view }: { view: PipelineView }) {
  const live = usePipelineChannel(view.id, { initialStatus: view.status });
  return <PipelineBody view={mergeLiveState(view, live)} scenes={live.scenes} />;
}
