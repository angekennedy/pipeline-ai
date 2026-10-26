import { redirect } from "next/navigation";

// Le tableau de bord du workspace arrive avec la tâche 2.4 : en attendant, la création d'un pipeline.
export default async function WorkspacePage({ params }: PageProps<"/w/[workspaceSlug]">) {
  const { workspaceSlug } = await params;
  redirect(`/w/${workspaceSlug}/pipelines/new`);
}
