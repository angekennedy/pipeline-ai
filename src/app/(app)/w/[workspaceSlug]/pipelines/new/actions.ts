"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { PlanRestrictionError, type PlanRestriction } from "@/lib/billing/entitlements";
import { InsufficientCreditsError, createPipelineWithReservation } from "@/lib/billing/reservation";
import { getChannel } from "@/lib/channels/store";
import { inngest } from "@/lib/jobs/client";
import { pipelineRequested } from "@/lib/jobs/events";
import { BRIEF_FIELD_MESSAGES, parseBriefForm, type BriefFormField, type BriefFormValues } from "@/lib/pipeline/brief-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { findMembership, hasRole } from "@/lib/workspaces/access";

export type CreatePipelineState = {
  fieldErrors: Partial<Record<BriefFormField, string>>;
  values: BriefFormValues; // saisie renvoyée pour réafficher le formulaire
  restriction?: PlanRestriction; // refusé par le plan (403) : message explicite et lien vers les tarifs
  insufficient?: { required: number; available: number }; // ouvre le modal « crédits insuffisants »
  launchError?: string; // pipeline créé mais non lancé : réservation libérée
};

const KeySchema = z.uuid();

// Création d'un pipeline (ARCHITECTURE §5.2) : appartenance et rôle revérifiés ici (une Server Action
// est appelable directement), brief validé, puis réservation en service role. La base refuse ce que
// le plan n'autorise pas et un solde insuffisant ; rien n'est créé dans ces deux cas.
// À venir : rate limit (tâche 4.5).
export async function createPipeline(_previous: CreatePipelineState, formData: FormData): Promise<CreatePipelineState> {
  const slug = String(formData.get("workspaceSlug") ?? "");
  const user = await requireUser(`/w/${slug}/pipelines/new`);
  const membership = await findMembership(await createClient(), user.id, slug);
  if (!membership || !hasRole(membership.role, "editor")) throw new Error("Workspace introuvable ou rôle insuffisant");

  const result = parseBriefForm(formData);
  if (!result.ok) return { fieldErrors: result.fieldErrors, values: result.values };
  const key = KeySchema.safeParse(formData.get("idempotencyKey"));
  if (!key.success) throw new Error("Clé de soumission invalide");

  // Preset relu sous RLS dans ce workspace, puis figé dans le pipeline (`channel_snapshot`) : le
  // modifier ensuite ne change pas les pipelines déjà créés.
  const { channelId } = result.brief;
  const channel = channelId ? await getChannel(await createClient(), membership.workspace.id, channelId) : null;
  if (channelId && !channel) return { fieldErrors: { channelId: BRIEF_FIELD_MESSAGES.channelId }, values: result.values };

  const admin = createAdminClient();
  let pipelineId: string;
  try {
    ({ pipelineId } = await createPipelineWithReservation(admin, {
      workspaceId: membership.workspace.id,
      userId: user.id,
      brief: result.brief,
      tier: result.tier,
      idempotencyKey: key.data,
      channel: channel ? { id: channel.id, snapshot: channel.preset } : undefined,
    }));
  } catch (error) {
    if (error instanceof PlanRestrictionError) return { fieldErrors: {}, values: result.values, restriction: error.restriction };
    if (error instanceof InsufficientCreditsError) {
      return { fieldErrors: {}, values: result.values, insufficient: { required: error.required, available: error.available } };
    }
    throw error;
  }

  // Id d'événement fixe : un double envoi, ou une soumission rejouée, ne lance qu'une exécution.
  try {
    await inngest.send(pipelineRequested.create({ pipelineId, workspaceId: membership.workspace.id }, { id: `pipeline-requested:${pipelineId}` }));
  } catch {
    // Sans exécution, la réservation resterait bloquée jusqu'au balayage : on la libère tout de suite.
    await admin.rpc("finalize_pipeline", { p_pipeline: pipelineId, p_status: "failed" });
    return { fieldErrors: {}, values: result.values, launchError: "Le lancement a échoué : aucun crédit n'a été débité. Réessayez dans un instant." };
  }
  refresh(); // le solde de l'en-tête (layout racine, conservé par le routeur) suit la réservation
  redirect(`/w/${slug}/pipelines/${pipelineId}`);
}
