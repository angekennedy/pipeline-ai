import { redirect } from "next/navigation";

// La page d'accueil d'un workspace est son tableau de bord.
export default async function WorkspacePage({ params }: PageProps<"/w/[workspaceSlug]">) {
  const { workspaceSlug } = await params;
  redirect(`/w/${workspaceSlug}/dashboard`);
}
