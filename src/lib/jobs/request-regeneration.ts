import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSET_TYPES, type AssetType, type Brief } from "@/lib/ai/schemas";
import { getCreditSummary } from "@/lib/billing/balance";
import { InsufficientCreditsError, releaseRegeneration, reserveRegeneration } from "@/lib/billing/reservation";
import { registry, type ModelTier } from "@/lib/pipeline/registry";
import type { Database } from "@/lib/supabase/database.types";
import { inngest } from "./client";
import { assetRegenerateRequested } from "./events";

// Demande de régénération (tâche 4.2) : réservation du coût de chaque asset, puis une exécution Inngest
// qui les régénère dans l'ordre du DAG. Appelée par la Server Action après vérification du rôle.

// Un pipeline encore en cours se termine d'abord : ses étapes écriraient en même temps.
export class PipelineBusyError extends Error {
  constructor() {
    super("Le pipeline est encore en cours : attendez la fin de la génération.");
    this.name = "PipelineBusyError";
  }
}

const TERMINAL = new Set(["completed", "partial", "failed", "canceled"]);

export type RegenerationRequest = {
  workspaceId: string;
  userId: string;
  pipelineId: string;
  types: AssetType[];
  nonce: string; // un par affichage du bouton : un double clic ne réserve et ne lance qu'une fois
  feedback?: string;
};

export const regenerationKey = (nonce: string, type: AssetType) => `regen:${nonce}-${type}`;

export async function requestRegeneration(admin: SupabaseClient<Database>, request: RegenerationRequest): Promise<{ credits: number }> {
  const { data: pipeline, error } = await admin
    .from("pipelines")
    .select("brief, model_tier, status")
    .eq("id", request.pipelineId)
    .eq("workspace_id", request.workspaceId)
    .single();
  if (error) throw new Error(`Pipeline ${request.pipelineId} : ${error.message}`);
  if (!TERMINAL.has(pipeline.status)) throw new PipelineBusyError();

  const brief = pipeline.brief as Brief;
  const tier = pipeline.model_tier as ModelTier;
  const types = ASSET_TYPES.filter((type) => request.types.includes(type)); // ordre du DAG
  if (types.length === 0) throw new Error("Aucun asset à régénérer");
  const items = types.map((type) => ({ assetType: type, regenerationKey: regenerationKey(request.nonce, type), credits: registry[type].credits(brief, tier) }));
  const total = items.reduce((sum, item) => sum + item.credits, 0);

  // Contrôle d'ensemble : rien n'est réservé si le tout ne passe pas. Chaque réservation revérifie.
  const { available } = await getCreditSummary(admin, request.workspaceId);
  if (available < total) throw new InsufficientCreditsError(total, available);

  const reserved: string[] = [];
  try {
    for (const item of items) {
      await reserveRegeneration(admin, { ...request, key: item.regenerationKey, credits: item.credits, tier });
      reserved.push(item.regenerationKey);
    }
    const [first, ...then] = items;
    await inngest.send(
      assetRegenerateRequested.create(
        {
          pipelineId: request.pipelineId,
          workspaceId: request.workspaceId,
          assetType: first!.assetType,
          regenerationKey: first!.regenerationKey,
          feedback: request.feedback,
          ...(then.length > 0 && { then: then.map(({ assetType, regenerationKey: key }) => ({ assetType, regenerationKey: key })) }),
        },
        { id: first!.regenerationKey },
      ),
    );
  } catch (error) {
    // Sans exécution, les crédits resteraient bloqués jusqu'au balayage : libérés tout de suite.
    for (const key of reserved) await releaseRegeneration(admin, key);
    throw error;
  }
  return { credits: total };
}
