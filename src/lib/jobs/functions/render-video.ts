import "server-only";
import { NonRetriableError } from "inngest";
import { runVideoSteps, type VideoStepRunner } from "@/lib/video/run-video";
import { inngest } from "../client";
import { videoRenderRequested } from "../events";
import { toStepError, type JobDeps } from "../step-errors";
import { releaseFailedRegeneration } from "./regenerate-asset";

// Vidéo MP4 lancée par l'utilisateur, une fois le script relu et ajusté (lib/jobs/request-video).
// Chaque erreur d'étape passe par toStepError (refus définitifs non relancés), et `sleep` d'Inngest
// attend le rendu sans tenir de place dans la limite de concurrence. Échec définitif : la réservation
// est libérée.
export function createRenderVideoFunction({ video, releaseRegeneration }: JobDeps) {
  return inngest.createFunction(
    {
      id: "render-video",
      triggers: [videoRenderRequested],
      idempotency: "event.data.regenerationKey", // un double envoi ne paie qu'une vidéo
      concurrency: [{ key: "event.data.pipelineId", limit: 1 }], // une vidéo à la fois par pipeline
      retries: 3,
      onFailure: releaseFailedRegeneration(releaseRegeneration),
    },
    async ({ event, step }) => {
      const deps = video?.();
      // i18n-ignore : message de diagnostic (Inngest, /admin), jamais affiché.
      if (!deps) throw new NonRetriableError("Vidéo non configurée (voix ou rendu)");
      const runner: VideoStepRunner = {
        run: (id, fn) =>
          step.run(id, () =>
            fn().catch((error: unknown) => {
              throw toStepError(error);
            }),
          ) as never,
        sleep: async (id, ms) => {
          await step.sleep(id, ms);
        },
      };
      const { pipelineId, regenerationKey, credits } = event.data;
      return { versionId: await runVideoSteps(pipelineId, { key: regenerationKey, credits }, runner, deps) };
    },
  );
}
