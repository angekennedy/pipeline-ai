import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { getLocale, getTranslations } from "next-intl/server";
import type { Language } from "@/lib/ai/schemas";
import { z } from "zod";
import { BriefForm } from "@/components/pipeline/brief-form";
import { channelOption } from "@/lib/channels/form";
import { videoAvailable } from "@/lib/media/config";
import { listChannels } from "@/lib/channels/store";
import { loadBriefValues } from "@/lib/pipeline/list";
import { isSampleBrief, sampleBriefValues } from "@/lib/pipeline/sample-briefs";
import { createClient } from "@/lib/supabase/server";
import { hasRole, requireMembership } from "@/lib/workspaces/access";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("newPipeline") };
}
export const instant = false; // bloque avec le layout (vérification d'appartenance)

export default async function NewPipelinePage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/pipelines/new">) {
  const { workspaceSlug } = await params;
  const { workspace, role, credits } = await requireMembership(workspaceSlug);
  const canEdit = hasRole(role, "editor");
  const t = await getTranslations("NewPipeline");

  // `?from=<pipeline>` : duplication d'un brief du même workspace. Un id inconnu ou d'un autre
  // workspace (RLS et filtre) laisse simplement le formulaire vide.
  const { from, example } = await searchParams;
  const db = await createClient();
  const [source, channels] = canEdit
    ? await Promise.all([
        typeof from === "string" && z.uuid().safeParse(from).success ? loadBriefValues(db, workspace.id, from) : null,
        listChannels(db, workspace.id),
      ])
    : [null, []];
  // `?example=<clé>` : brief d'exemple de l'onboarding (tâche 5.4), lien de l'état vide du tableau de bord.
  const onboarding = await getTranslations("Onboarding");
  const sample = !source && isSampleBrief(example)
    ? sampleBriefValues(example, { niche: onboarding(`samples.${example}.niche`), topic: onboarding(`samples.${example}.topic`) }, (await getLocale()) as Language)
    : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-1 mb-8 text-muted-foreground">
        {t("intro")}
      </p>
      {canEdit ? (
        <>
          {source && (
            <p role="status" className="mb-6 rounded-xl border bg-muted/50 p-4 text-sm">
              {t("copied", { title: source.title })}
            </p>
          )}
          {sample && (
            <p role="status" className="mb-6 rounded-xl border bg-muted/50 p-4 text-sm">
              {onboarding("filled")}
            </p>
          )}
          {/* Une clé par affichage du formulaire : un double envoi ne crée et ne débite qu'un pipeline. */}
          <BriefForm
            workspaceSlug={workspace.slug}
            credits={credits}
            idempotencyKey={randomUUID()}
            initialValues={source?.values ?? sample ?? undefined}
            channels={channels.map(channelOption)}
            showSamples={!source && !sample}
            videoAvailable={videoAvailable()}
          />
        </>
      ) : (
        <p role="status" className="rounded-xl border p-4 text-sm">
          {t("viewer", { workspace: workspace.name })}
        </p>
      )}
    </main>
  );
}
