import "server-only";
import type { PromptContext } from "@/lib/ai/prompts";
import { BriefSchema, type AssetType } from "@/lib/ai/schemas";
import { registry, type AssetContent } from "@/lib/pipeline/registry";
import { emptyPipelineView, type AssetView, type PipelineView } from "@/lib/pipeline/view";
import financeEn from "./examples/en-finance-compound.json";
import romeFr from "./examples/fr-histoire-rome.json";

// Pipelines d'exemple réels (tâche 5.1) : sorties brutes des modèles lors de l'évaluation v3
// (evals/report/v3, mêmes versions de prompts qu'aujourd'hui), validées par les schémas actuels puis
// post-traitées comme une génération. Rien n'est réécrit à la main. Coût et durée sont ceux mesurés.

export const EXAMPLE_IDS = ["demo-rome", "demo-compound-interest"] as const;
export type ExampleId = (typeof EXAMPLE_IDS)[number];

type ExampleFile = typeof romeFr;

export type ExampleMeta = { costUsd: number; generationSeconds: number; judge: number; models: { script: string; derived: string } };
export type Example = { view: PipelineView; meta: ExampleMeta };

const FILES: Record<ExampleId, ExampleFile> = { "demo-rome": romeFr, "demo-compound-interest": financeEn as ExampleFile };
// Date de l'évaluation v3.
const CREATED_AT = "2026-10-25T01:40:00.000Z";

function build(id: ExampleId): Example {
  const file = FILES[id];
  const brief = BriefSchema.parse(file.brief);
  const ctx: PromptContext = { brief, channel: null };
  // Comme generateAsset : la sortie du modèle est validée par le contrat de l'asset, puis post-traitée.
  const accept = <K extends AssetType>(type: K, context: PromptContext) =>
    registry[type].postProcess(registry[type].schema(context).parse(file.assets[type]) as never, context) as AssetContent[K];
  const script = accept("script", ctx);
  const derived = { ...ctx, script };
  const titles = accept("titles", derived);
  const ready = <K extends AssetType>(type: K, content: AssetContent[K]): AssetView<K> => ({
    status: "ready",
    content,
    error: null,
    stale: false,
    versions: [{ id: `${id}-${type}-v1`, version: 1, source: "ai", createdAt: CREATED_AT }],
  });
  const view: PipelineView = {
    ...emptyPipelineView({ id, brief, tier: "standard", createdAt: CREATED_AT }),
    status: "completed",
    assets: {
      script: ready("script", script),
      titles: ready("titles", titles),
      seo: ready("seo", accept("seo", derived)),
      voiceover: ready("voiceover", accept("voiceover", derived)),
      thumbnails: ready("thumbnails", accept("thumbnails", { ...derived, titles })),
    },
  };
  return {
    view,
    meta: { costUsd: file.costUsd, generationSeconds: file.generationSeconds, judge: file.judge, models: { script: file.models.script, derived: file.models.titles } },
  };
}

const cache = new Map<ExampleId, Example>();

export function example(id: string): Example | null {
  if (!EXAMPLE_IDS.includes(id as ExampleId)) return null;
  const key = id as ExampleId;
  if (!cache.has(key)) cache.set(key, build(key));
  return cache.get(key)!;
}

// L'exemple dans la langue de l'interface, l'autre à défaut.
export const exampleFor = (locale: string): ExampleId => (locale === "en" ? "demo-compound-interest" : "demo-rome");
