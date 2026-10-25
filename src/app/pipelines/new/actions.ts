"use server";

import { redirect } from "next/navigation";
import { parseBriefForm, type BriefFormField, type BriefFormValues } from "@/lib/pipeline/brief-form";

export type CreatePipelineState = {
  fieldErrors: Partial<Record<BriefFormField, string>>;
  values: BriefFormValues; // saisie renvoyée pour réafficher le formulaire
};

// Mode démo, en attendant la base (tâche 0.4) : le brief est validé comme en production, puis on
// affiche une génération de démonstration. À venir ici : authentification, rate limit, réservation
// des crédits, création du pipeline et envoi de l'événement `pipeline/requested`.
export async function createPipeline(_previous: CreatePipelineState, formData: FormData): Promise<CreatePipelineState> {
  const result = parseBriefForm(formData);
  if (!result.ok) return { fieldErrors: result.fieldErrors, values: result.values };
  redirect("/pipelines/demo-running");
}
