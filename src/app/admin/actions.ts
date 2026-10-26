"use server";

import { refresh } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { isPlatformAdmin } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/session";
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
