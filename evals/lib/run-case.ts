import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { modelFor } from "@/lib/ai/models";
import { prompts, type PromptContext } from "@/lib/ai/prompts";
import { ASSET_TYPES, type AssetType, type Brief, type Script, type Titles } from "@/lib/ai/schemas";
import { generateAsset, generationKey } from "@/lib/pipeline/generate-asset";
import { registry, type ModelTier } from "@/lib/pipeline/registry";
import { runPipelineSteps } from "@/lib/pipeline/run-pipeline";
import { MemoryPipelineStore } from "../../tests/mocks/memory-store";
import type { PipelineOutput } from "./checks";

// Exécute un pipeline complet par le vrai chemin de l'application (runPipelineSteps → generateAsset →
// callStructured), sur un store en mémoire : seuls la base et Inngest sont absents.

export type Turn = { role: "system" | "user" | "assistant"; content: string };

export type AssetTelemetry = {
  expectedModel: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsdMicros: number | null;
  repairs: number;
  failure: string | null;
  failureMessage: string | null; // détail (issues Zod, message de l'API) pour comprendre l'échec
};

export type CaseRun = {
  output: PipelineOutput;
  trace: Turn[];
  assets: Record<AssetType, AssetTelemetry>;
  latencyS: number;
};

const text = (content: unknown) =>
  typeof content === "string" ? content : (content as Array<{ text: string }>).map((block) => block.text).join("\n\n");

export async function runCase(brief: Brief, tier: ModelTier, { client }: { client?: Anthropic } = {}): Promise<CaseRun> {
  const store = new MemoryPipelineStore();
  const pipelineId = randomUUID();
  store.addPipeline({ id: pipelineId, workspaceId: "evals", brief, channel: null, tier });

  const startedAt = performance.now();
  await runPipelineSteps(pipelineId, {
    step: { run: (_id, fn) => fn() },
    store,
    generate: (type) => generateAsset(pipelineId, type, { store, client }),
  });
  const latencyS = (performance.now() - startedAt) / 1000;

  const content = Object.fromEntries(
    await Promise.all(ASSET_TYPES.map(async (type) => [type, (await store.getCurrentVersion(pipelineId, type))?.content] as const)),
  ) as PipelineOutput["assets"];

  const assets = {} as Record<AssetType, AssetTelemetry>;
  const failures: PipelineOutput["failures"] = {};
  for (const type of ASSET_TYPES) {
    const generation = store.generations.get(generationKey(pipelineId, type));
    const telemetry = generation?.telemetry;
    const failure = generation?.failure?.code ?? (generation ? null : "SKIPPED");
    if (failure) failures[type] = failure;
    assets[type] = {
      expectedModel: modelFor(registry[type].modelKey(tier)).id,
      model: telemetry?.model ?? null,
      inputTokens: telemetry?.usage.inputTokens ?? 0,
      outputTokens: telemetry?.usage.outputTokens ?? 0,
      cacheReadTokens: telemetry?.usage.cacheReadTokens ?? 0,
      cacheCreationTokens: telemetry?.usage.cacheCreationTokens ?? 0,
      costUsdMicros: telemetry ? telemetry.costUsdMicros : (generation?.failure?.costUsdMicros ?? 0),
      repairs: telemetry?.repairs ?? 0,
      failure,
      failureMessage: generation?.failure?.message ?? null,
    };
  }

  // Transcription : le prompt envoyé pour chaque asset (reconstruit à l'identique) et sa sortie.
  const ctx: PromptContext = { brief, channel: null, script: content.script as Script | undefined, titles: content.titles as Titles | undefined };
  const trace: Turn[] = [];
  for (const type of ASSET_TYPES) {
    if (assets[type].failure === "SKIPPED") continue;
    const prompt = registry[type].dependsOn.every((dep) => content[dep]) ? prompts[type].build(ctx) : null;
    if (prompt) {
      trace.push({ role: "system", content: `[${type}]\n${text(prompt.system)}` });
      trace.push({ role: "user", content: text(prompt.messages[0]!.content) });
    }
    trace.push({ role: "assistant", content: content[type] ? JSON.stringify(content[type], null, 2) : `Échec : ${assets[type].failure}` });
  }

  return { output: { brief, assets: content, failures }, trace, assets, latencyS };
}
