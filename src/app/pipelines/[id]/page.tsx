import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getFormatter } from "next-intl/server";
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
  const t = await getTranslations("Meta");
  if (!demo) return { title: t("pipelineNotFound") };
  return { title: t("demo", { topic: demo.view.brief.topic }), description: t("demoDescription", { topic: demo.view.brief.topic }) };
}

// claude-sonnet-5-5 → Claude Sonnet 5.5
const modelName = (id: string) =>
  id.replace(/^claude-([a-z]+)-(\d+)-(\d+)$/, (_, family: string, major: string, minor: string) => `Claude ${family[0]!.toUpperCase()}${family.slice(1)} ${major}.${minor}`);

// Mode démo, en attendant la base (tâche 0.4) : seuls les pipelines d'exemple existent.
export default async function PipelinePage({ params }: PageProps<"/pipelines/[id]">) {
  const { id } = await params;
  const demo = demoPipeline(id);
  if (!demo) notFound();
  const { brief } = demo.view;
  const [t, format] = await Promise.all([getTranslations("PipelinePage"), getFormatter()]);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <p className="mb-4 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
        {!demo.replay && demo.example
          ? t("exampleNotice", {
              script: modelName(demo.example.models.script),
              derived: modelName(demo.example.models.derived),
              cost: format.number(demo.example.costUsd, { style: "currency", currency: "USD", maximumFractionDigits: 2 }),
              seconds: demo.example.generationSeconds,
            })
          : t("demoNotice")}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">{brief.topic}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        {[brief.niche, `${brief.durationMinutes} min`, brief.language.toUpperCase()].join(" · ")}
      </p>
      {demo.replay ? <DemoReplayPipeline view={demo.view} final={demo.final} /> : <StaticPipeline view={demo.view} />}
    </main>
  );
}
