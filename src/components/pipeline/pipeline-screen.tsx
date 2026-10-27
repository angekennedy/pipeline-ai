"use client";

import { useTranslations } from "next-intl";
import { ASSET_TYPES, type Scene } from "@/lib/ai/schemas";
import { useDemoPipeline } from "@/hooks/use-demo-pipeline";
import { usePipelineChannel } from "@/hooks/use-pipeline-channel";
import type { PipelineStatus } from "@/lib/pipeline/status";
import { mergeLiveState, type PipelineView } from "@/lib/pipeline/view";
import { Badge } from "@/components/ui/badge";
import { StaleBanner } from "./asset-history";
import { AutoRefresh, PipelineActionsProvider, type PipelineActionsValue } from "./pipeline-actions";
import { AssetTabs } from "./asset-tabs";
import { VideoPanel } from "./video-panel";

const STATUS_VARIANTS: Record<PipelineStatus, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "outline",
  running: "secondary",
  completed: "default",
  partial: "destructive",
  failed: "destructive",
  canceled: "outline",
};

export function PipelineStatusBadge({ status }: { status: PipelineStatus }) {
  const t = useTranslations("Labels");
  return (
    <span aria-live="polite">
      <Badge variant={STATUS_VARIANTS[status]}>{t(`pipelineStatus.${status}`)}</Badge>
    </span>
  );
}

function PipelineBody({ view, scenes }: { view: PipelineView; scenes: Scene[] }) {
  const t = useTranslations("Pipeline");
  const hint = view.status === "partial" || view.status === "failed" ? t(`hint.${view.status}`) : null;
  const stale = ASSET_TYPES.filter((type) => view.assets[type].stale);
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <PipelineStatusBadge status={view.status} />
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {stale.length > 0 && <StaleBanner types={stale} credits={view.staleCredits} />}
      <AssetTabs view={view} scenes={scenes} />
      {view.video && <VideoPanel video={view.video} pipelineStatus={view.status} durationMinutes={view.brief.durationMinutes} />}
    </div>
  );
}

// Pipeline terminé ou relu en base, sans suivi en direct. `actions` : pipeline réel ouvert par un
// éditeur (édition, restauration, régénération) ; la page est relue tant qu'un asset se régénère.
export function StaticPipeline({ view, actions = null }: { view: PipelineView; actions?: PipelineActionsValue | null }) {
  const regenerating = ASSET_TYPES.some((type) => view.assets[type].status === "running");
  return (
    <PipelineActionsProvider value={actions}>
      <AutoRefresh active={Boolean(actions) && regenerating} />
      <PipelineBody view={view} scenes={[]} />
    </PipelineActionsProvider>
  );
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
