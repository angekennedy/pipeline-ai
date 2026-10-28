"use server";

import { refresh } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { isPlatformAdmin } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/session";
import { setInternalWorkspace } from "@/lib/admin/internal-workspaces";
import { addInvite, removeInvite, setInviteOnly } from "@/lib/beta";
import { createAdminClient } from "@/lib/supabase/admin";

// Réglages de la bêta fermée depuis /admin (tâche 5.6). Une Server Action est appelable directement :
// l'administrateur est revérifié ici, comme dans la page.
async function requireAdmin() {
  const user = await requireUser("/admin");
  if (!isPlatformAdmin(user.email)) notFound();
  return createAdminClient();
}

export async function toggleInviteOnly(formData: FormData) {
  const admin = await requireAdmin();
  await setInviteOnly(admin, formData.get("enabled") === "true");
  refresh();
}

const InviteForm = z.object({ email: z.email().max(320), note: z.string().trim().max(200).optional() });

export async function addBetaInvite(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = InviteForm.safeParse({ email: String(formData.get("email") ?? "").trim(), note: String(formData.get("note") ?? "") || undefined });
  if (!parsed.success) redirect("/admin?invite=invalid");
  await addInvite(admin, parsed.data.email, parsed.data.note);
  redirect("/admin?invite=added");
}

export async function removeBetaInvite(formData: FormData) {
  const admin = await requireAdmin();
  await removeInvite(admin, z.email().parse(formData.get("email")));
  refresh();
}

// Workspace interne (migration 0018) : crédits illimités et toutes les fonctionnalités, pour les tests.
const Slug = z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,64}$/);

export async function markInternalWorkspace(formData: FormData) {
  const admin = await requireAdmin();
  const slug = Slug.safeParse(formData.get("slug"));
  if (!slug.success) redirect("/admin?internal=unknown");
  const done = await setInternalWorkspace(admin, slug.data, formData.get("enabled") !== "false");
  redirect(`/admin?internal=${done ? "updated" : "unknown"}`);
}
