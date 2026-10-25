"use client";

import { useEffect, useReducer, useState } from "react";
import { demoTimeline } from "@/lib/demo/timeline";
import { mergeLiveState, revealAsset, type PipelineView } from "@/lib/pipeline/view";
import { applyPipelineEvent, initialLiveState } from "@/lib/realtime/pipeline-state";

// Mode démo : rejoue une génération avec les mêmes événements et le même reducer que Realtime.
// Là où le vrai hook relirait la page (router.refresh), on révèle l'asset depuis la vue finale.
export function useDemoPipeline(initial: PipelineView, final: PipelineView) {
  const [live, dispatch] = useReducer(applyPipelineEvent, initial.status, initialLiveState);
  const [view, setView] = useState(initial);

  useEffect(() => {
    const timers = demoTimeline(final).map(({ at, event }) =>
      setTimeout(() => {
        dispatch(event);
        if (event.type === "asset.completed" || event.type === "asset.failed") {
          setView((current) => revealAsset(current, final, event.asset));
        } else if (event.type === "pipeline.status") {
          setView((current) => ({ ...current, status: event.status }));
        }
      }, at),
    );
    return () => timers.forEach(clearTimeout);
  }, [final]);

  return { view: mergeLiveState(view, live), scenes: live.scenes };
}
