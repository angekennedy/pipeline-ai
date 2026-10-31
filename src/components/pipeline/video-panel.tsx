"use client";

import { useTranslations } from "next-intl";
import type { PipelineStatus } from "@/lib/pipeline/status";
import type { VideoView } from "@/lib/pipeline/view";
import { VIDEO_CREDITS_PER_MINUTE } from "@/lib/billing/credit-rules";
import { buttonVariants } from "@/components/ui/button";
import { AssetStatusIcon } from "./asset-tabs";
import { AutoRefresh, GenerateVideoButton, usePipelineActions } from "./pipeline-actions";

const TERMINAL: ReadonlySet<PipelineStatus> = new Set(["completed", "partial", "failed", "canceled"]);

// Vidéo MP4 du pipeline. L'utilisateur la lance après avoir relu et ajusté le script : elle en suit
// la version courante (narration lue mot pour mot, une image par ligne de direction visuelle). Puis
// lecture, téléchargement et rappel des règles de YouTube sur les contenus générés.
// `pipelineId` : le téléchargement passe par /api/pipelines/[id]/video, qui force l'enregistrement du fichier.
export function VideoPanel({ pipelineId, video, pipelineStatus }: { pipelineId: string; video: VideoView; pipelineStatus: PipelineStatus }) {
  const t = useTranslations("Video");
  const failures = useTranslations("Failures");
  const actions = usePipelineActions();
  const done = TERMINAL.has(pipelineStatus);
  const { status, credits } = video;
  const failure = !video.error
    ? null
    : video.error.code === "IMAGE_REFUSED" && video.error.sceneIndex
      ? t("imageRefused", { scene: video.error.sceneIndex })
      : failures.has(video.error.code as never)
        ? failures(video.error.code as never)
        : failures("generic");
  // Rendu : environ 1,5 fois la durée de la vidéo, au moins 5 min.
  const minutes = Math.max(5, Math.round(((credits ?? 0) / VIDEO_CREDITS_PER_MINUTE) * 1.5));
  const launch = (label: string) => credits !== null && done && <GenerateVideoButton credits={credits} label={label} />;

  return (
    <section aria-labelledby="video" className="grid gap-3 rounded-xl border p-4">
      <h2 id="video" className="flex items-center gap-2 font-medium">
        <AssetStatusIcon status={status} />
        {t("title")}
      </h2>
      {status === "pending" && !done && <p className="text-sm text-muted-foreground">{t("afterScript")}</p>}
      {status === "pending" && done && credits === null && <p className="text-sm text-muted-foreground">{t("noScript")}</p>}
      {status === "pending" && done && credits !== null && (
        <>
          <p className="text-sm text-muted-foreground">{t("review")}</p>
          <div>{launch(t("generate"))}</div>
        </>
      )}
      {status === "running" && (
        <p className="text-sm text-muted-foreground">
          {t("running", { minutes })}
          <AutoRefresh active={Boolean(actions)} intervalMs={15_000} />
        </p>
      )}
      {failure && status !== "running" && (
        <p role="alert" className="text-sm text-destructive">
          {failure} {t("refunded")}
        </p>
      )}
      {status === "failed" && <div>{launch(t("retry"))}</div>}
      {status === "ready" && video.content && (
        <>
          <video controls preload="metadata" src={video.content.url} className="aspect-video w-full rounded-lg bg-black">
            {t("noPlayer")}
          </video>
          {video.content.sandbox && (
            <p role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              {t("sandbox")}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <a href={`/api/pipelines/${pipelineId}/video`} download className={buttonVariants({ size: "sm" })}>
              {t("download")}
            </a>
            <span className="text-sm text-muted-foreground">{t("details", { minutes: Math.max(1, Math.round(video.content.durationSeconds / 60)) })}</span>
          </div>
          <p className="text-sm text-muted-foreground">{t("disclosure")}</p>
          {video.scriptChanged && <p className="text-sm text-muted-foreground">{t("scriptChanged")}</p>}
          <div>{launch(t("regenerate"))}</div>
        </>
      )}
    </section>
  );
}
