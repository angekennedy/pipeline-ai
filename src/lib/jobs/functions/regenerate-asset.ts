import "server-only";
import { generateAsset } from "@/lib/pipeline/generate-asset";
import { staleAssetsOf } from "@/lib/pipeline/staleness";
import { inngest } from "../client";
import { assetRegenerateRequested } from "../events";
import { toStepError, type JobDeps } from "../step-errors";

// Échec définitif, une fois les relances épuisées : la réservation de chaque asset demandé est libérée
// (sans effet pour ceux déjà régénérés, dont les crédits sont capturés). Une tentative ratée ne libère
// rien, Inngest pouvant encore la relancer.
export const releaseFailedRegeneration =
  (release: JobDeps["releaseRegeneration"]) =>
  async ({ event }: { event: { data: { event: { data: { regenerationKey: string; then?: Array<{ regenerationKey: string }> } } } } }) => {
    const { regenerationKey, then = [] } = event.data.event.data;
    for (const key of [regenerationKey, ...then.map((item) => item.regenerationKey)]) await release?.(key);
  };

// Régénération à la demande de l'utilisateur : un asset, puis ses dérivés demandés, l'un après l'autre
// dans l'ordre du DAG (les miniatures partent des titres régénérés). Les autres assets ne sont pas
// touchés : ceux devenus obsolètes sont renvoyés pour que l'interface propose de les régénérer.
export function createRegenerateAssetFunction({ store, openai, publisher, releaseRegeneration }: JobDeps) {
  return inngest.createFunction(
    {
      id: "regenerate-asset",
      triggers: [assetRegenerateRequested],
      idempotency: "event.data.regenerationKey", // un double envoi ne paie qu'une génération
      concurrency: [{ key: "event.data.workspaceId", limit: 2 }],
      retries: 3,
      onFailure: releaseFailedRegeneration(releaseRegeneration),
    },
    async ({ event, step }) => {
      const { pipelineId, assetType, regenerationKey, feedback, then = [] } = event.data;
      const versions: string[] = [];
      for (const [i, item] of [{ assetType, regenerationKey }, ...then].entries()) {
        const versionId = await step.run(`regenerate:${item.assetType}`, () =>
          generateAsset(pipelineId, item.assetType, {
            store: store(),
            client: openai,
            publish: publisher?.(pipelineId),
            regeneration: { key: item.regenerationKey, feedback: i === 0 ? feedback : undefined },
          }).catch((error: unknown) => {
            throw toStepError(error);
          }),
        );
        versions.push(versionId);
      }
      const stale = await step.run("staleness", () => staleAssetsOf(store(), pipelineId));
      return { versionIds: versions, stale };
    },
  );
}
