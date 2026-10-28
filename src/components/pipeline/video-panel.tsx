"use client";

import { useTranslations } from "next-intl";
import type { PipelineStatus } from "@/lib/pipeline/status";
import type { VideoView } from "@/lib/pipeline/view";
import { buttonVariants } from "@/components/ui/button";
import { AssetStatusIcon } from "./asset-tabs";

// Vidéo MP4 du pipeline : lecture, téléchargement et rappel des règles de YouTube sur les contenus
// générés. Pendant la génération, l'étape la plus longue du pipeline (images, voix, rendu).
// `pipelineId` : le téléchargement passe par /api/pipelines/[id]/video, qui force l'enregistrement du fichier.
export function VideoPanel({
  pipelineId,
  video,
  pipelineStatus,
  durationMinutes,
}: {
  pipelineId: string;
  video: VideoView;
  pipelineStatus: PipelineStatus;
  durationMinutes: number;
}) {
  const t = useTranslations("Video");
  const failures = useTranslations("Failures");
  // Le pipeline tourne encore : la vidéo attend ou est en cours, même sans événement en direct.
  const status = video.status === "pending" && pipelineStatus === "running" ? "running" : video.status;
  const failure = video.error ? (failures.has(video.error.code as never) ? failures(video.error.code as never) : failures("generic")) : null;

  return (
    <section aria-labelledby="video" className="grid gap-3 rounded-xl border p-4">
      <h2 id="video" className="flex items-center gap-2 font-medium">
        <AssetStatusIcon status={status} />
        {t("title")}
      </h2>
      {status === "pending" && <p className="text-sm text-muted-foreground">{t("pending")}</p>}
      {status === "running" && <p className="text-sm text-muted-foreground">{t("running", { minutes: Math.max(5, Math.round(durationMinutes * 1.5)) })}</p>}
      {status === "skipped" && <p className="text-sm text-muted-foreground">{t("skipped")}</p>}
      {status === "failed" && (
        <p role="alert" className="text-sm text-destructive">
          {failure} {t("refunded")}
        </p>
      )}
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
        </>
      )}
    </section>
  );
}
