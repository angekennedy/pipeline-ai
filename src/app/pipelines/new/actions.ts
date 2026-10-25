"use server";

import { redirect } from "next/navigation";
import { pipelineCredits } from "@/lib/billing/costs";
import { DEMO_CREDITS } from "@/lib/demo/credits";
import { parseBriefForm, type BriefFormField, type BriefFormValues } from "@/lib/pipeline/brief-form";

export type CreatePipelineState = {
  fieldErrors: Partial<Record<BriefFormField, string>>;
  values: BriefFormValues; // saisie renvoyée pour réafficher le formulaire
  insufficient?: { required: number; available: number }; // ouvre le modal « crédits insuffisants »
};

// Mode démo, en attendant l'authentification (phase 2) : le brief est validé comme en production et
// son coût comparé au solde de démonstration, puis on affiche une génération de démonstration.
// À venir ici : rate limit, createPipelineWithReservation (dont InsufficientCreditsError donne
// `insufficient`) et envoi de l'événement `pipeline/requested`.
export async function createPipeline(_previous: CreatePipelineState, formData: FormData): Promise<CreatePipelineState> {
  const result = parseBriefForm(formData);
  if (!result.ok) return { fieldErrors: result.fieldErrors, values: result.values };

  const required = pipelineCredits(result.brief, result.tier);
  if (required > DEMO_CREDITS.available) {
    return { fieldErrors: {}, values: result.values, insufficient: { required, available: DEMO_CREDITS.available } };
  }
  redirect("/pipelines/demo-running");
}
