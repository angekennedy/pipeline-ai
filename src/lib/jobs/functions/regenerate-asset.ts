import "server-only";
import { generateAsset } from "@/lib/pipeline/generate-asset";
import { staleAssetsOf } from "@/lib/pipeline/staleness";
import { inngest } from "../client";
import { assetRegenerateRequested } from "../events";
import { toStepError, type JobDeps } from "../step-errors";

// Régénération d'un seul asset, à la demande de l'utilisateur. Elle ne touche à aucun autre asset :
// les dérivés devenus obsolètes sont renvoyés pour que l'interface propose de les régénérer.
export function createRegenerateAssetFunction({ store, anthropic, publisher }: JobDeps) {
  return inngest.createFunction(
    {
      id: "regenerate-asset",
      triggers: [assetRegenerateRequested],
      idempotency: "event.data.regenerationKey", // un double envoi ne paie qu'une génération
      concurrency: [{ key: "event.data.workspaceId", limit: 2 }],
      retries: 3,
    },
    async ({ event, step }) => {
      const { pipelineId, assetType, regenerationKey, feedback } = event.data;
      const versionId = await step.run("regenerate", () =>
        generateAsset(pipelineId, assetType, {
          store: store(),
          client: anthropic,
          publish: publisher?.(pipelineId),
          regeneration: { key: regenerationKey, feedback },
        }).catch((error: unknown) => {
          throw toStepError(error);
        }),
      );
      const stale = await step.run("staleness", () => staleAssetsOf(store(), pipelineId));
      return { versionId, stale };
    },
  );
}
