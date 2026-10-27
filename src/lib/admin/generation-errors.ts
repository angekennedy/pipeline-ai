import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetType } from "@/lib/ai/schemas";
import type { Database } from "@/lib/supabase/database.types";

// Dernières générations en échec, avec le message exact du fournisseur ou de la validation
// (`generations.error_message`, tronqué à 2 000 caractères par fail_generation). Réservé aux
// administrateurs de la plateforme : à lire en service role, jamais affiché aux workspaces.

export type GenerationError = {
  id: string;
  pipelineId: string;
  assetType: AssetType;
  createdAt: string;
  attempt: number;
  model: string | null;
  promptVersion: string | null;
  code: string | null;
  message: string | null;
};

export async function recentGenerationErrors(
  db: SupabaseClient<Database>,
  { pipelineId, limit = 20 }: { pipelineId?: string; limit?: number } = {},
): Promise<GenerationError[]> {
  let query = db
    .from("generations")
    .select("id, pipeline_id, asset_type, created_at, attempt, model, prompt_version, error_code, error_message")
    .eq("status", "failed");
  if (pipelineId) query = query.eq("pipeline_id", pipelineId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Erreurs de génération : ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    pipelineId: row.pipeline_id,
    assetType: row.asset_type,
    createdAt: row.created_at,
    attempt: row.attempt,
    model: row.model,
    promptVersion: row.prompt_version,
    code: row.error_code,
    message: row.error_message,
  }));
}
