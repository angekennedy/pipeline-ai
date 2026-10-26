import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { requireWorkspace } from "@/lib/workspaces/current";

export const instant = false; // redirection avant tout rendu

// Raccourci du lien « Mes pipelines » : vers le tableau de bord du workspace personnel.
export default async function DashboardShortcut() {
  await requireUser("/dashboard");
  const workspace = await requireWorkspace();
  redirect(`/w/${workspace.slug}/dashboard`);
}
