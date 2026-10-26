"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AccountDeletionBlockedError, deleteAccount, stripeNotConfigured } from "@/lib/account/delete";
import { requireUser } from "@/lib/auth/session";
import { billingEnabled, getStripe, stripeCanceler } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { findMembership, hasRole } from "@/lib/workspaces/access";

// `error` : clé du message affiché (Settings.errors) ; `workspaces` : ceux qui bloquent la suppression.
export type SettingsState = {
  error?: "displayName" | "workspaceName" | "confirmation" | "workspaceShared" | "subscription";
  workspaces?: string;
  saved?: boolean;
};

const DisplayName = z.string().trim().min(1).max(80);

// Profil : la RLS (own_profile) limite l'écriture à la ligne de l'utilisateur.
export async function updateProfile(_previous: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser("/settings");
  const name = DisplayName.safeParse(formData.get("displayName"));
  if (!name.success) return { error: "displayName" };
  const db = await createClient();
  const { error } = await db.from("profiles").update({ display_name: name.data }).eq("id", user.id);
  if (error) throw new Error(`Profil de ${user.id} : ${error.message}`);
  return { saved: true };
}

// Nom d'un workspace : réservé aux admins (ws_admin), seules les colonnes name et slug sont modifiables.
export async function renameWorkspace(_previous: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser("/settings");
  const slug = String(formData.get("workspaceSlug") ?? "");
  const db = await createClient();
  const membership = await findMembership(db, user.id, slug);
  if (!membership || !hasRole(membership.role, "admin")) throw new Error("Workspace introuvable ou rôle insuffisant");
  const name = DisplayName.safeParse(formData.get("workspaceName"));
  if (!name.success) return { error: "workspaceName" };
  const { error } = await db.from("workspaces").update({ name: name.data }).eq("id", membership.workspace.id);
  if (error) throw new Error(`Workspace ${slug} : ${error.message}`);
  refresh();
  return { saved: true };
}

// Suppression définitive (RGPD) : l'utilisateur retape son adresse e-mail pour confirmer. Le compte
// supprimé, la session est effacée du navigateur.
export async function deleteAccountAction(_previous: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser("/settings");
  const confirmation = String(formData.get("confirmation") ?? "").trim().toLowerCase();
  if (!user.email || confirmation !== user.email.toLowerCase()) return { error: "confirmation" };

  try {
    // Résiliation réelle chez Stripe quand il est configuré ; sinon un abonnement bloque la suppression.
    await deleteAccount(createAdminClient(), user.id, { cancelSubscriptions: billingEnabled() ? stripeCanceler(getStripe()) : stripeNotConfigured });
  } catch (error) {
    if (error instanceof AccountDeletionBlockedError) {
      return error.block.reason === "workspace_shared" ? { error: "workspaceShared", workspaces: error.block.workspaces } : { error: "subscription" };
    }
    throw error;
  }
  // Le jeton reste signé jusqu'à son expiration : sans ces cookies effacés, l'application croirait
  // l'utilisateur toujours connecté.
  await (await createClient()).auth.signOut({ scope: "local" });
  redirect("/compte-supprime");
}
