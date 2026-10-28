"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { track } from "@/lib/analytics/posthog";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { PlanRestrictionError, type PlanRestriction } from "@/lib/billing/entitlements";
import { InsufficientCreditsError, createPipelineWithReservation } from "@/lib/billing/reservation";
import { getChannel } from "@/lib/channels/store";
import { inngest } from "@/lib/jobs/client";
import { pipelineRequested } from "@/lib/jobs/events";
import { effectivePlan } from "@/lib/billing/balance";
import { videoAvailable } from "@/lib/media/config";
import { parseBriefForm, type BriefFieldErrors, type BriefFormValues } from "@/lib/pipeline/brief-form";
import { moderateBrief, ModerationUnavailableError, type ModerationCategory } from "@/lib/security/moderation";
import { enforceRateLimit, RateLimitedError, retryMinutes } from "@/lib/security/rate-limit";
import { enforceSpendGuard, SpendPausedError } from "@/lib/security/spend-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { findMembership, hasRole } from "@/lib/workspaces/access";

export type CreatePipelineState = {
  fieldErrors: BriefFieldErrors; // messages affichés par le formulaire (BriefForm.errors)
  values: BriefFormValues; // saisie renvoyée pour réafficher le formulaire
  restriction?: PlanRestriction; // refusé par le plan (403) : message explicite et lien vers les tarifs
  insufficient?: { required: number; available: number }; // ouvre le modal « crédits insuffisants »
  launchError?: true; // pipeline créé mais non lancé : réservation libérée
  // Refus avant toute réservation (tâche 4.5) : aucun crédit n'est débité.
  rateLimited?: { minutes: number };
  spendPaused?: true;
  moderated?: ModerationCategory;
  moderationUnavailable?: true;
};

const KeySchema = z.uuid();

// Création d'un pipeline (ARCHITECTURE §5.2) : appartenance et rôle revérifiés ici (une Server Action
// est appelable directement), brief validé, puis réservation en service role. La base refuse ce que
// le plan n'autorise pas et un solde insuffisant ; rien n'est créé dans ces deux cas.
// Avant la réservation, dans cet ordre (tâche 4.5) : rate limit, disjoncteur de dépense, puis
// modération, la seule étape qui peut appeler le modèle.
export async function createPipeline(_previous: CreatePipelineState, formData: FormData): Promise<CreatePipelineState> {
  const slug = String(formData.get("workspaceSlug") ?? "");
  const user = await requireUser(`/w/${slug}/pipelines/new`);
  const membership = await findMembership(await createClient(), user.id, slug);
  if (!membership || !hasRole(membership.role, "editor")) throw new Error("Workspace introuvable ou rôle insuffisant");

  const result = parseBriefForm(formData);
  if (!result.ok) return { fieldErrors: result.fieldErrors, values: result.values };
  // Vidéo demandée sans voix ni rendu configurés (formulaire resté ouvert, requête forgée) : refusée
  // avant toute réservation. Le plan, lui, est revérifié en base.
  if (result.brief.video && !videoAvailable()) return { fieldErrors: { video: true }, values: result.values };
  // Miniatures en images HD selon le plan, jamais selon le formulaire.
  if (effectivePlan(membership.credits).thumbnailImages) result.brief.thumbnailImages = true;
  const key = KeySchema.safeParse(formData.get("idempotencyKey"));
  if (!key.success) throw new Error("Clé de soumission invalide");

  // Preset relu sous RLS dans ce workspace, puis figé dans le pipeline (`channel_snapshot`) : le
  // modifier ensuite ne change pas les pipelines déjà créés.
  const { channelId } = result.brief;
  const channel = channelId ? await getChannel(await createClient(), membership.workspace.id, channelId) : null;
  if (channelId && !channel) return { fieldErrors: { channelId: true }, values: result.values };

  const admin = createAdminClient();
  const refused = (state: Partial<CreatePipelineState>): CreatePipelineState => ({ fieldErrors: {}, values: result.values, ...state });
  try {
    await enforceRateLimit(admin, [
      { rule: "pipelineUser", subject: user.id },
      { rule: "pipelineWorkspace", subject: membership.workspace.id },
    ]);
    await enforceSpendGuard(admin, membership.workspace.id);
    const verdict = await moderateBrief(result.brief);
    if (!verdict.allowed) return refused({ moderated: verdict.category });
  } catch (error) {
    if (error instanceof RateLimitedError) return refused({ rateLimited: { minutes: retryMinutes(error.retryAfterSeconds) } });
    if (error instanceof SpendPausedError) return refused({ spendPaused: true });
    if (error instanceof ModerationUnavailableError) return refused({ moderationUnavailable: true });
    throw error;
  }

  let pipelineId: string;
  let created: boolean;
  try {
    ({ pipelineId, created } = await createPipelineWithReservation(admin, {
      workspaceId: membership.workspace.id,
      userId: user.id,
      brief: result.brief,
      tier: result.tier,
      idempotencyKey: key.data,
      channel: channel ? { id: channel.id, snapshot: channel.preset } : undefined,
    }));
  } catch (error) {
    if (error instanceof PlanRestrictionError) return refused({ restriction: error.restriction });
    if (error instanceof InsufficientCreditsError) return refused({ insufficient: { required: error.required, available: error.available } });
    throw error;
  }

  // Id d'événement fixe : un double envoi, ou une soumission rejouée, ne lance qu'une exécution.
  try {
    await inngest.send(pipelineRequested.create({ pipelineId, workspaceId: membership.workspace.id }, { id: `pipeline-requested:${pipelineId}` }));
  } catch {
    // Sans exécution, la réservation resterait bloquée jusqu'au balayage : on la libère tout de suite.
    await admin.rpc("finalize_pipeline", { p_pipeline: pipelineId, p_status: "failed" });
    return refused({ launchError: true });
  }
  // Funnel (tâche 5.3) : une soumission rejouée ne compte pas un second pipeline.
  if (created) {
    const properties = { tier: result.tier, minutes: result.brief.durationMinutes };
    after(() => track(user.id, { name: "pipeline_created", properties }, pipelineId));
  }
  refresh(); // le solde de l'en-tête (layout racine, conservé par le routeur) suit la réservation
  redirect(`/w/${slug}/pipelines/${pipelineId}`);
}
