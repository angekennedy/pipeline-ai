"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { pipelineCredits } from "@/lib/billing/costs";
import { pipelineRestriction, type PlanRestriction } from "@/lib/billing/entitlements";
import { requireWorkspace } from "@/lib/workspaces/current";
import { parseBriefForm, type BriefFormField, type BriefFormValues } from "@/lib/pipeline/brief-form";

export type CreatePipelineState = {
  fieldErrors: Partial<Record<BriefFormField, string>>;
  values: BriefFormValues; // saisie renvoyée pour réafficher le formulaire
  restriction?: PlanRestriction; // refusé par le plan (403) : message explicite et lien vers les tarifs
  insufficient?: { required: number; available: number }; // ouvre le modal « crédits insuffisants »
};

// L'utilisateur est connecté et le brief validé comme en production, puis confronté au plan et au
// solde de son workspace. La génération reste celle de démonstration jusqu'aux routes /w (tâche 2.3).
// À venir ici : rate limit, createPipelineWithReservation (dont PlanRestrictionError et
// InsufficientCreditsError donnent `restriction` et `insufficient`), événement `pipeline/requested`.
export async function createPipeline(_previous: CreatePipelineState, formData: FormData): Promise<CreatePipelineState> {
  await requireUser("/pipelines/new"); // une Server Action est appelable directement : revérifiée ici
  const result = parseBriefForm(formData);
  if (!result.ok) return { fieldErrors: result.fieldErrors, values: result.values };

  const { credits } = await requireWorkspace();
  const restriction = pipelineRestriction(credits.planKey, result.brief, result.tier);
  if (restriction) return { fieldErrors: {}, values: result.values, restriction };

  const required = pipelineCredits(result.brief, result.tier);
  if (required > credits.available) {
    return { fieldErrors: {}, values: result.values, insufficient: { required, available: credits.available } };
  }
  redirect("/pipelines/demo-running");
}
