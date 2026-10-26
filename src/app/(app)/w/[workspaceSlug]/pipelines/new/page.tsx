import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { BriefForm } from "@/components/pipeline/brief-form";
import { channelOption } from "@/lib/channels/form";
import { listChannels } from "@/lib/channels/store";
import { loadBriefValues } from "@/lib/pipeline/list";
import { createClient } from "@/lib/supabase/server";
import { hasRole, requireMembership } from "@/lib/workspaces/access";

export const metadata: Metadata = { title: "Nouveau pipeline · Pipeline AI" };
export const instant = false; // bloque avec le layout (vérification d'appartenance)

export default async function NewPipelinePage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/pipelines/new">) {
  const { workspaceSlug } = await params;
  const { workspace, role, credits } = await requireMembership(workspaceSlug);
  const canEdit = hasRole(role, "editor");

  // `?from=<pipeline>` : duplication d'un brief du même workspace. Un id inconnu ou d'un autre
  // workspace (RLS et filtre) laisse simplement le formulaire vide.
  const { from } = await searchParams;
  const db = await createClient();
  const [source, channels] = canEdit
    ? await Promise.all([
        typeof from === "string" && z.uuid().safeParse(from).success ? loadBriefValues(db, workspace.id, from) : null,
        listChannels(db, workspace.id),
      ])
    : [null, []];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Nouveau pipeline</h1>
      <p className="mt-1 mb-8 text-muted-foreground">
        Décrivez la vidéo : le script, les titres, le SEO, la voix off et les miniatures sont générés à partir de ce brief.
      </p>
      {canEdit ? (
        <>
          {source && (
            <p role="status" className="mb-6 rounded-xl border bg-muted/50 p-4 text-sm">
              Brief repris de « {source.title} ». Modifiez-le avant de lancer : un nouveau pipeline sera créé.
            </p>
          )}
          {/* Une clé par affichage du formulaire : un double envoi ne crée et ne débite qu'un pipeline. */}
          <BriefForm
            workspaceSlug={workspace.slug}
            credits={credits}
            idempotencyKey={randomUUID()}
            initialValues={source?.values}
            channels={channels.map(channelOption)}
          />
        </>
      ) : (
        <p role="status" className="rounded-xl border p-4 text-sm">
          Votre rôle dans {workspace.name} permet de consulter les pipelines, pas d&apos;en créer. Demandez à un administrateur de vous passer
          éditeur.
        </p>
      )}
    </main>
  );
}
