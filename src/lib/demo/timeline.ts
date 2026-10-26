import type { AssetType } from "@/lib/ai/schemas";
import type { PipelineView } from "@/lib/pipeline/view";
import type { PipelineEvent } from "@/lib/realtime/events";

// Rejoue côté navigateur une génération de démonstration. Module sans dépendance serveur : le
// registre et les prompts restent hors du bundle client.

export type TimedEvent = { at: number; event: PipelineEvent }; // ms depuis l'ouverture de la page

// Chronologie d'une génération qui aboutit à `final` : mêmes événements que Realtime, rythmés
// comme une génération réelle (première scène en quelques secondes, dérivés en parallèle).
export function demoTimeline(final: PipelineView): TimedEvent[] {
  const events: TimedEvent[] = [];
  const emit = (at: number, event: PipelineEvent) => events.push({ at, event });
  const settle = (at: number, type: AssetType) => {
    const asset = final.assets[type];
    if (asset.status === "ready") emit(at, { type: "asset.completed", asset: type, versionId: `${final.id}:${type}:v1` });
    else if (asset.status === "failed") emit(at, { type: "asset.failed", asset: type, code: asset.error?.code ?? "INTERNAL" });
  };

  emit(0, { type: "pipeline.status", status: "running" });
  emit(300, { type: "asset.started", asset: "script" });
  let at = 300;
  const scenes = final.assets.script.content?.scenes ?? [];
  scenes.forEach((scene, i) => {
    at = 1500 + i * 900;
    emit(at, { type: "asset.partial", asset: "script", scenes: [scene] });
  });
  const scriptDone = (at += 600);
  settle(scriptDone, "script");

  let end = scriptDone;
  if (final.assets.script.status === "ready") {
    const durations = { titles: 1400, seo: 2300, voiceover: 2800 } as const;
    for (const type of ["titles", "seo", "voiceover"] as const) {
      if (final.assets[type].status === "skipped") continue;
      emit(scriptDone + 200, { type: "asset.started", asset: type });
      settle(scriptDone + 200 + durations[type], type);
      end = Math.max(end, scriptDone + 200 + durations[type]);
    }
    if (final.assets.titles.status === "ready" && final.assets.thumbnails.status !== "skipped") {
      const titlesDone = scriptDone + 200 + durations.titles;
      emit(titlesDone, { type: "asset.started", asset: "thumbnails" });
      settle(titlesDone + 1600, "thumbnails");
      end = Math.max(end, titlesDone + 1600);
    }
  }
  emit(end + 300, { type: "pipeline.status", status: final.status });
  return events.sort((a, b) => a.at - b.at);
}
