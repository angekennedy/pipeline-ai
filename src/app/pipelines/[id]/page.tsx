import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoReplayPipeline, StaticPipeline } from "@/components/pipeline/pipeline-screen";
import { DEMO_PIPELINE_IDS, demoPipeline } from "@/lib/demo/pipelines";

// Démonstrations connues au build : pages et métadonnées prérendues, la description dans le <head>
// (une métadonnée calculée à la requête serait diffusée dans le <body>, hors de portée des outils
// qui ne lisent que le <head>).
export const generateStaticParams = () => DEMO_PIPELINE_IDS.map((id) => ({ id }));

export async function generateMetadata({ params }: PageProps<"/pipelines/[id]">): Promise<Metadata> {
  const { id } = await params;
  const demo = demoPipeline(id);
  if (!demo) return { title: "Pipeline introuvable · Pipeline AI" };
  return {
    title: `${demo.view.brief.topic} · Pipeline AI`,
    description: `Démonstration Pipeline AI : script, titres, SEO, voix off et miniatures pour « ${demo.view.brief.topic} ».`,
  };
}

// Mode démo, en attendant la base (tâche 0.4) : seuls les pipelines d'exemple existent.
export default async function PipelinePage({ params }: PageProps<"/pipelines/[id]">) {
  const { id } = await params;
  const demo = demoPipeline(id);
  if (!demo) notFound();
  const { brief } = demo.view;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <p className="mb-4 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
        Démonstration : contenu d&apos;exemple, aucune génération réelle n&apos;est lancée.
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">{brief.topic}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        {brief.niche} · {brief.durationMinutes} min · {brief.language.toUpperCase()}
      </p>
      {demo.replay ? <DemoReplayPipeline view={demo.view} final={demo.final} /> : <StaticPipeline view={demo.view} />}
    </main>
  );
}
