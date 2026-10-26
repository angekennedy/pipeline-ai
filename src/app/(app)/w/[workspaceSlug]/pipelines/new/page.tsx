import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { BriefForm } from "@/components/pipeline/brief-form";
import { hasRole, requireMembership } from "@/lib/workspaces/access";

export const metadata: Metadata = { title: "Nouveau pipeline · Pipeline AI" };
export const instant = false; // bloque avec le layout (vérification d'appartenance)

export default async function NewPipelinePage({ params }: PageProps<"/w/[workspaceSlug]/pipelines/new">) {
  const { workspaceSlug } = await params;
  const { workspace, role, credits } = await requireMembership(workspaceSlug);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Nouveau pipeline</h1>
      <p className="mt-1 mb-8 text-muted-foreground">
        Décrivez la vidéo : le script, les titres, le SEO, la voix off et les miniatures sont générés à partir de ce brief.
      </p>
      {hasRole(role, "editor") ? (
        // Une clé par affichage du formulaire : un double envoi ne crée et ne débite qu'un pipeline.
        <BriefForm workspaceSlug={workspace.slug} credits={credits} idempotencyKey={randomUUID()} />
      ) : (
        <p role="status" className="rounded-xl border p-4 text-sm">
          Votre rôle dans {workspace.name} permet de consulter les pipelines, pas d&apos;en créer. Demandez à un administrateur de vous passer
          éditeur.
        </p>
      )}
    </main>
  );
}
