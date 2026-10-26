import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { requireWorkspace } from "@/lib/workspaces/current";

export const instant = false; // redirection avant tout rendu

// Raccourci du badge de crédits et de la page des tarifs : vers la facturation du workspace personnel.
export default async function BillingShortcut() {
  await requireUser("/billing");
  const workspace = await requireWorkspace();
  redirect(`/w/${workspace.slug}/billing`);
}
