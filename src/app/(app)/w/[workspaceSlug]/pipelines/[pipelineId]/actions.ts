"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { ASSET_TYPES, ScriptSchema } from "@/lib/ai/schemas";
import { requireUser } from "@/lib/auth/session";
import { PlanRestrictionError, restrictionMessage } from "@/lib/billing/entitlements";
import { InsufficientCreditsError } from "@/lib/billing/reservation";
import { PipelineBusyError, requestRegeneration } from "@/lib/jobs/request-regeneration";
import { applyScriptForm, scriptFieldErrors } from "@/lib/pipeline/script-form";
import { AssetValidationError, editAsset, restoreVersion } from "@/lib/pipeline/versions";
import { createAdminClient } from "@/lib/supabase/admin";
import { SupabasePipelineStore } from "@/lib/supabase/pipeline-store";
import { createClient } from "@/lib/supabase/server";
import { findMembership, hasRole } from "@/lib/workspaces/access";

// Écritures sur un pipeline (tâche 4.2) : édition du script, restauration d'une version, régénération.
// Rôle `editor` et appartenance du pipeline au workspace revérifiés ici (actions appelables
// directement), puis écriture en service role par les fonctions du domaine.

const TERMINAL = new Set(["completed", "partial", "failed", "canceled"]);
const BUSY = "Le pipeline est encore en cours : attendez la fin de la génération.";

async function editorOf(formData: FormData) {
  const slug = String(formData.get("workspaceSlug") ?? "");
  const pipelineId = z.uuid().parse(formData.get("pipelineId"));
  const user = await requireUser(`/w/${slug}/pipelines/${pipelineId}`);
  const membership = await findMembership(await createClient(), user.id, slug);
  if (!membership || !hasRole(membership.role, "editor")) throw new Error("Workspace introuvable ou rôle insuffisant");
  const admin = createAdminClient();
  const { data: pipeline, error } = await admin
    .from("pipelines")
    .select("status")
    .eq("id", pipelineId)
    .eq("workspace_id", membership.workspace.id)
    .maybeSingle();
  if (error) throw new Error(`Pipeline ${pipelineId} : ${error.message}`);
  if (!pipeline) throw new Error("Pipeline introuvable dans ce workspace");
  return { user, workspaceId: membership.workspace.id, pipelineId, admin, terminal: TERMINAL.has(pipeline.status) };
}

export type ScriptEditState = { fieldErrors: Record<string, string>; error?: string; saved?: boolean };

// Nouvelle version `user_edit` du script, gratuite. Les dérivés deviennent obsolètes et se
// régénèrent à partir d'elle.
export async function saveScript(_previous: ScriptEditState, formData: FormData): Promise<ScriptEditState> {
  const { user, pipelineId, admin, terminal } = await editorOf(formData);
  if (!terminal) return { fieldErrors: {}, error: BUSY };
  const store = new SupabasePipelineStore(admin);
  const current = await store.getCurrentVersion(pipelineId, "script");
  if (!current) return { fieldErrors: {}, error: "Ce pipeline n'a pas encore de script à modifier." };

  try {
    await editAsset(pipelineId, "script", applyScriptForm(ScriptSchema.parse(current.content), formData), { store, userId: user.id });
  } catch (error) {
    if (error instanceof AssetValidationError) return { fieldErrors: scriptFieldErrors(error.issues), error: "Corrigez les champs signalés." };
    throw error;
  }
  refresh();
  return { fieldErrors: {}, saved: true };
}

// Restaurer crée une copie de l'ancienne version : l'historique reste linéaire.
export async function restoreAssetVersion(formData: FormData): Promise<void> {
  const { user, pipelineId, admin, terminal } = await editorOf(formData);
  if (!terminal) throw new Error(BUSY);
  const type = z.enum(ASSET_TYPES).parse(formData.get("assetType"));
  await restoreVersion(pipelineId, type, z.uuid().parse(formData.get("versionId")), { store: new SupabasePipelineStore(admin), userId: user.id });
  refresh();
}

export type RegenerateState = {
  error?: string;
  insufficient?: { required: number; available: number };
  requested?: boolean;
};

// Régénère un asset, ou les dérivés obsolètes (plusieurs `assetType`), au même coût qu'une génération.
export async function regenerateAssets(_previous: RegenerateState, formData: FormData): Promise<RegenerateState> {
  const { user, workspaceId, pipelineId, admin } = await editorOf(formData);
  const types = z.array(z.enum(ASSET_TYPES)).min(1).parse(formData.getAll("assetType"));
  const nonce = z.uuid().parse(formData.get("nonce"));
  const feedback = String(formData.get("feedback") ?? "").trim() || undefined;
  try {
    await requestRegeneration(admin, { workspaceId, userId: user.id, pipelineId, types, nonce, feedback: feedback?.slice(0, 1000) });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) return { insufficient: { required: error.required, available: error.available } };
    if (error instanceof PlanRestrictionError) return { error: restrictionMessage(error.restriction) };
    if (error instanceof PipelineBusyError) return { error: error.message };
    throw error;
  }
  refresh(); // solde de l'en-tête et état des assets
  return { requested: true };
}
