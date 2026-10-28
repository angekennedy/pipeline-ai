import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ScriptSchema, type Brief } from "@/lib/ai/schemas";
import { effectivePlan, getCreditSummary } from "@/lib/billing/balance";
import { videoCreditsFor } from "@/lib/billing/credit-rules";
import { PlanRestrictionError } from "@/lib/billing/entitlements";
import { InsufficientCreditsError, releaseRegeneration, reserveRegeneration } from "@/lib/billing/reservation";
import { videoAvailable } from "@/lib/media/config";
import type { ModelTier } from "@/lib/pipeline/registry";
import { SupabasePipelineStore } from "@/lib/supabase/pipeline-store";
import type { Database } from "@/lib/supabase/database.types";
import { videoMinutesOf } from "@/lib/video/length";
import { inngest } from "./client";
import { videoRenderRequested } from "./events";
import { PipelineBusyError } from "./request-regeneration";

// « Générer la vidéo » : l'utilisateur relit et ajuste le script, puis lance la vidéo, qui suit la
// version courante du script. Coût d'après la longueur de ce script, réservé comme une régénération
// (clé `regen:`), puis une exécution Inngest (render-video). Appelée par la Server Action après
// vérification du rôle.

// Une vidéo de ce pipeline est déjà en file ou en cours.
export class VideoBusyError extends Error {
  constructor() {
    super("Une vidéo de ce pipeline est déjà en cours.");
    this.name = "VideoBusyError";
  }
}

// Voix ou rendu non configurés (media/config).
export class VideoUnavailableError extends Error {
  constructor() {
    super("La vidéo n'est pas disponible pour le moment.");
    this.name = "VideoUnavailableError";
  }
}

const TERMINAL = new Set(["completed", "partial", "failed", "canceled"]);

export type VideoRequest = { workspaceId: string; userId: string; pipelineId: string; nonce: string };

export const videoKey = (nonce: string) => `regen:${nonce}-video`;

export async function requestVideo(admin: SupabaseClient<Database>, request: VideoRequest): Promise<{ credits: number }> {
  const { data: pipeline, error } = await admin
    .from("pipelines")
    .select("brief, model_tier, status")
    .eq("id", request.pipelineId)
    .eq("workspace_id", request.workspaceId)
    .single();
  if (error) throw new Error(`Pipeline ${request.pipelineId} : ${error.message}`);
  if (!TERMINAL.has(pipeline.status)) throw new PipelineBusyError();
  if (!videoAvailable()) throw new VideoUnavailableError();

  const summary = await getCreditSummary(admin, request.workspaceId);
  if (!effectivePlan(summary).video) throw new PlanRestrictionError({ reason: "video", plan: summary.planKey });

  const { data: running, error: runningError } = await admin
    .from("generations")
    .select("id")
    .eq("pipeline_id", request.pipelineId)
    .eq("asset_type", "video")
    .in("status", ["queued", "running"])
    .limit(1);
  if (runningError) throw new Error(`Générations vidéo : ${runningError.message}`);
  if (running.length > 0) throw new VideoBusyError();

  const store = new SupabasePipelineStore(admin);
  const script = await store.getCurrentVersion(request.pipelineId, "script");
  if (!script) throw new Error("Ce pipeline n'a pas de script");
  const brief = pipeline.brief as Brief;
  const credits = videoCreditsFor(videoMinutesOf(ScriptSchema.parse(script.content), brief.language));
  if (!summary.unlimited && summary.available < credits) throw new InsufficientCreditsError(credits, summary.available);

  const key = videoKey(request.nonce);
  const reserved = await reserveRegeneration(admin, { ...request, key, credits, tier: pipeline.model_tier as ModelTier });
  if (!reserved) return { credits }; // double envoi : déjà réservée et lancée
  try {
    // Génération créée tout de suite : la page l'affiche en file, et un second clic est refusé.
    await store.upsertGeneration({ pipelineId: request.pipelineId, assetType: "video", idempotencyKey: key, credits });
    await inngest.send(videoRenderRequested.create({ pipelineId: request.pipelineId, workspaceId: request.workspaceId, regenerationKey: key, credits }, { id: key }));
  } catch (error) {
    // Sans exécution, les crédits resteraient bloqués jusqu'au balayage : libérés tout de suite.
    await releaseRegeneration(admin, key);
    throw error;
  }
  return { credits };
}
