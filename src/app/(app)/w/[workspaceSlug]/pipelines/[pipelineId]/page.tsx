import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ExportMenu } from "@/components/pipeline/export-menu";
import { LivePipeline, StaticPipeline } from "@/components/pipeline/pipeline-screen";
import { loadPipelineView } from "@/lib/pipeline/load-view";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { hasRole, requireMembership } from "@/lib/workspaces/access";

export const metadata: Metadata = { title: "Pipeline · Pipeline AI" };
export const instant = false; // 404 réel pour un pipeline d'un autre workspace

const TERMINAL = new Set(["completed", "partial", "failed", "canceled"]);

export default async function PipelinePage({ params }: PageProps<"/w/[workspaceSlug]/pipelines/[pipelineId]">) {
  const { workspaceSlug, pipelineId } = await params;
  if (!z.uuid().safeParse(pipelineId).success) notFound();
  const { workspace, role } = await requireMembership(workspaceSlug);
  // Client de l'utilisateur : la RLS et le filtre par workspace limitent la lecture à ce workspace.
  const view = await loadPipelineView(await createClient(), workspace.id, pipelineId);
  if (!view) notFound();
  const { brief } = view;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <Link href={`/w/${workspace.slug}/dashboard`} className="text-muted-foreground hover:text-foreground">
          ← Tous les pipelines
        </Link>
        {hasRole(role, "editor") && (
          <Link href={`/w/${workspace.slug}/pipelines/new?from=${pipelineId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Dupliquer le brief
          </Link>
        )}
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{brief.topic}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        {[brief.niche, `${brief.durationMinutes} min`, brief.language.toUpperCase(), view.channelName && `Preset ${view.channelName}`]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {TERMINAL.has(view.status) ? (
        <StaticPipeline view={view} actions={hasRole(role, "editor") ? { workspaceSlug: workspace.slug, pipelineId: view.id } : null} />
      ) : (
        <LivePipeline view={view} />
      )}
      {TERMINAL.has(view.status) && view.assets.script.status === "ready" && (
        <div className="mt-6">
          <ExportMenu pipelineId={view.id} />
        </div>
      )}
    </main>
  );
}
