import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { requireWorkspace } from "@/lib/workspaces/current";

export const instant = false; // redirection avant tout rendu

// Raccourci des liens « Nouveau pipeline » : vers le workspace personnel de l'utilisateur.
export default async function NewPipelineShortcut() {
  await requireUser("/pipelines/new");
  const workspace = await requireWorkspace();
  redirect(`/w/${workspace.slug}/pipelines/new`);
}
