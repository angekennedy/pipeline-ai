import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Brief, ChannelPreset } from "@/lib/ai/schemas";
import type { ModelTier } from "@/lib/pipeline/registry";
import type { Database, Json } from "@/lib/supabase/database.types";
import { pipelineCredits } from "./costs";
import { PlanRestrictionError, restrictionFromDetails } from "./entitlements";

// Solde disponible (balance − reserved) insuffisant : rien n'a été créé. L'interface ouvre le modal
// d'upgrade avec ces deux montants.
export class InsufficientCreditsError extends Error {
  readonly code = "INSUFFICIENT_CREDITS";
  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(`Crédits insuffisants : ${required} requis, ${available} disponibles`);
    this.name = "InsufficientCreditsError";
  }
}

export type CreatePipelineInput = {
  workspaceId: string;
  userId: string; // membre au moins `editor`, revérifié par la RPC
  brief: Brief; // déjà validé par BriefSchema
  tier: ModelTier;
  idempotencyKey: string; // une par soumission du formulaire : un double clic ne débite qu'une fois
  channel?: { id: string; snapshot: ChannelPreset };
};

export type CreatedPipeline = { pipelineId: string; created: boolean; credits: number };

// Crée le pipeline et réserve son coût total en une transaction (create_pipeline_with_reservation).
// La base refuse d'abord ce que le plan n'autorise pas (PlanRestrictionError, 403), puis un solde
// insuffisant (InsufficientCreditsError).
// `created: false` : la même clé a déjà créé ce pipeline, sans nouvelle réservation.
export async function createPipelineWithReservation(db: SupabaseClient<Database>, input: CreatePipelineInput): Promise<CreatedPipeline> {
  const credits = pipelineCredits(input.brief, input.tier);
  const { data, error } = await db.rpc("create_pipeline_with_reservation", {
    p_workspace: input.workspaceId,
    p_user: input.userId,
    p_brief: input.brief as Json,
    p_tier: input.tier,
    p_credits: credits,
    p_key: input.idempotencyKey,
    p_channel: input.channel?.id,
    p_channel_snapshot: input.channel?.snapshot as Json | undefined,
  });
  if (error) {
    if (error.message === "INSUFFICIENT_CREDITS") {
      const detail = JSON.parse(error.details) as { required: number; available: number };
      throw new InsufficientCreditsError(detail.required, detail.available);
    }
    if (error.message === "PLAN_RESTRICTED") throw new PlanRestrictionError(restrictionFromDetails(error.details));
    throw Object.assign(new Error(`Création du pipeline : ${error.message}`), { code: error.code });
  }
  const row = data[0];
  if (!row) throw new Error("Création du pipeline : aucune ligne renvoyée");
  return { pipelineId: row.pipeline_id, created: row.created, credits };
}

// Filet de sécurité (cron Inngest) : pipelines `queued` ou `running` sans activité depuis 30 min
// passés en échec, réservation libérée. Renvoie le nombre de pipelines balayés.
export async function sweepStaleReservations(db: SupabaseClient<Database>): Promise<number> {
  const { data, error } = await db.rpc("sweep_stale_reservations");
  if (error) throw Object.assign(new Error(`Balayage des réservations : ${error.message}`), { code: error.code });
  return data;
}
