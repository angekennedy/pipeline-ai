"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AccountDeletionBlockedError, deleteAccount } from "@/lib/account/delete";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { findMembership, hasRole } from "@/lib/workspaces/access";

export type SettingsState = { error?: string; saved?: boolean };

const DisplayName = z.string().trim().min(1).max(80);

// Profil : la RLS (own_profile) limite l'écriture à la ligne de l'utilisateur.
export async function updateProfile(_previous: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser("/settings");
  const name = DisplayName.safeParse(formData.get("displayName"));
  if (!name.success) return { error: "Le nom affiché tient en 1 à 80 caractères." };
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
  if (!name.success) return { error: "Le nom du workspace tient en 1 à 80 caractères." };
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
  if (!user.email || confirmation !== user.email.toLowerCase()) return { error: "Saisissez exactement votre adresse e-mail pour confirmer." };

  try {
    await deleteAccount(createAdminClient(), user.id);
  } catch (error) {
    if (error instanceof AccountDeletionBlockedError) return { error: error.message };
    throw error;
  }
  // Le jeton reste signé jusqu'à son expiration : sans ces cookies effacés, l'application croirait
  // l'utilisateur toujours connecté.
  await (await createClient()).auth.signOut({ scope: "local" });
  redirect("/compte-supprime");
}
