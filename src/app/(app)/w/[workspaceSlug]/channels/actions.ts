"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { PlanRestrictionError, type PlanRestriction } from "@/lib/billing/entitlements";
import { parseChannelForm, type ChannelFieldErrors, type ChannelFormValues } from "@/lib/channels/form";
import { createChannel, deleteChannel, updateChannel } from "@/lib/channels/store";
import { createClient } from "@/lib/supabase/server";
import { findMembership, hasRole } from "@/lib/workspaces/access";

export type ChannelFormState = {
  fieldErrors: ChannelFieldErrors; // messages affichés par le formulaire (ChannelForm.errors)
  values: ChannelFormValues; // saisie renvoyée pour réafficher le formulaire
  restriction?: PlanRestriction; // limite de presets du plan atteinte (403)
};

const IdSchema = z.uuid();

// Appartenance et rôle revérifiés dans chaque action (appelable directement) ; la RLS (ch_write) et le
// trigger de limite du plan tranchent ensuite en base.
async function editorOf(slug: string) {
  const user = await requireUser(`/w/${slug}/channels`);
  const db = await createClient();
  const membership = await findMembership(db, user.id, slug);
  if (!membership || !hasRole(membership.role, "editor")) throw new Error("Workspace introuvable ou rôle insuffisant");
  return { db, workspaceId: membership.workspace.id };
}

// Création, ou modification si le formulaire porte un `channelId`.
export async function saveChannel(_previous: ChannelFormState, formData: FormData): Promise<ChannelFormState> {
  const slug = String(formData.get("workspaceSlug") ?? "");
  const { db, workspaceId } = await editorOf(slug);
  const rawId = formData.get("channelId");
  const channelId = rawId ? IdSchema.parse(rawId) : null;

  const result = parseChannelForm(formData);
  if (!result.ok) return { fieldErrors: result.fieldErrors, values: result.values };

  try {
    if (channelId) {
      if (!(await updateChannel(db, workspaceId, channelId, result.preset))) throw new Error(`Preset ${channelId} introuvable`);
    } else {
      await createChannel(db, workspaceId, result.preset);
    }
  } catch (error) {
    if (error instanceof PlanRestrictionError) return { fieldErrors: {}, values: result.values, restriction: error.restriction };
    throw error;
  }
  redirect(`/w/${slug}/channels`);
}

export async function removeChannel(formData: FormData): Promise<void> {
  const slug = String(formData.get("workspaceSlug") ?? "");
  const { db, workspaceId } = await editorOf(slug);
  await deleteChannel(db, workspaceId, IdSchema.parse(formData.get("channelId")));
  redirect(`/w/${slug}/channels`);
}
