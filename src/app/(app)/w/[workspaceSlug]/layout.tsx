import { requireMembership } from "@/lib/workspaces/access";

// Vérifie l'appartenance avant tout rendu : un non-membre reçoit un vrai 404, émis avant le début du
// streaming (un notFound() sous <Suspense> garderait le statut 200). Le segment bloque donc sur le
// serveur, le temps d'une requête sous RLS.
export const instant = false;

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]">) {
  const { workspaceSlug } = await params;
  await requireMembership(workspaceSlug);
  return children;
}
