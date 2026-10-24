import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { PromptContext } from "@/lib/ai/prompts";
import { assetSchemas, type AssetType, type Script, type Titles } from "@/lib/ai/schemas";
import { LlmError, callStructured } from "@/lib/ai/structured";
import { registry, type AssetDefinition } from "./registry";
import type { GenerationFailure, PipelineRecord, PipelineStore } from "./store";

// Une dépendance absente ne se résout pas en relançant l'étape : erreur définitive.
export class MissingDependencyError extends Error {
  readonly code = "DEPENDENCY_MISSING";
  readonly retryable = false;

  constructor(readonly missing: AssetType[]) {
    super(`Dépendances manquantes : ${missing.join(", ")}`);
    this.name = "MissingDependencyError";
  }
}

export type GenerateAssetOptions = {
  store: PipelineStore;
  client?: Anthropic;
  onText?: (delta: string, snapshot: string) => void;
  signal?: AbortSignal;
};

export const generationKey = (pipelineId: string, type: AssetType) => `pipe:${pipelineId}:${type}`;

async function loadContext(store: PipelineStore, pipeline: PipelineRecord, type: AssetType) {
  const deps = await Promise.all(
    registry[type].dependsOn.map(async (dep) => [dep, await store.getCurrentVersion(pipeline.id, dep)] as const),
  );
  const missing = deps.filter(([, version]) => version === null).map(([dep]) => dep);
  if (missing.length > 0) throw new MissingDependencyError(missing);

  // Le contenu relu de la base est revalidé : le typage de PromptContext repose dessus.
  const versions = Object.fromEntries(deps.map(([dep, version]) => [dep, { id: version!.id, content: assetSchemas[dep].parse(version!.content) }]));
  const ctx: PromptContext = {
    brief: pipeline.brief,
    channel: pipeline.channel,
    script: versions.script?.content as Script | undefined,
    titles: versions.titles?.content as Titles | undefined,
  };
  return { ctx, sourceScriptVersionId: versions.script?.id ?? null };
}

function failureOf(error: unknown): GenerationFailure {
  if (error instanceof LlmError) return { code: error.code, message: error.message, costUsdMicros: error.costUsdMicros };
  if (error instanceof MissingDependencyError) return { code: error.code, message: error.message, costUsdMicros: null };
  if (error instanceof Anthropic.APIError) return { code: "PROVIDER_ERROR", message: error.message, costUsdMicros: null };
  return { code: "INTERNAL", message: error instanceof Error ? error.message : String(error), costUsdMicros: null };
}

// Cœur idempotent d'une étape du pipeline. Rejouée après un succès (retry Inngest, double envoi),
// elle renvoie la version déjà enregistrée sans rappeler le modèle. Renvoie l'id de version : le
// contenu reste en base, hors de l'état des étapes Inngest.
export async function generateAsset(pipelineId: string, type: AssetType, options: GenerateAssetOptions): Promise<string> {
  const { store } = options;
  // Vue non corrélée : schema(ctx) et postProcess portent le même type d'asset, ce que TypeScript
  // ne sait pas relier à travers l'union des clés.
  const def = registry[type] as unknown as AssetDefinition<AssetType>;
  const pipeline = await store.getPipeline(pipelineId);
  const generation = await store.upsertGeneration({
    pipelineId,
    assetType: type,
    idempotencyKey: generationKey(pipelineId, type),
    credits: def.credits(pipeline.brief, pipeline.tier),
  });
  if (generation.status === "succeeded" && generation.versionId) return generation.versionId;

  try {
    const { ctx, sourceScriptVersionId } = await loadContext(store, pipeline, type);
    await store.markRunning(generation.id, generation.attempt + 1);

    const prompt = def.prompt.build(ctx);
    const startedAt = performance.now();
    const result = await callStructured(
      {
        modelKey: def.modelKey(pipeline.tier),
        system: prompt.system,
        messages: prompt.messages,
        schema: def.schema(ctx),
        maxTokens: def.maxTokens(pipeline.brief),
        onText: options.onText,
        signal: options.signal,
      },
      options.client ? { client: options.client } : {},
    );

    return await store.commitAssetVersion({
      generationId: generation.id,
      pipelineId,
      assetType: type,
      content: def.postProcess(result.data, ctx),
      schemaVersion: def.schemaVersion,
      sourceScriptVersionId: type === "script" ? null : sourceScriptVersionId,
      telemetry: {
        model: result.model,
        promptVersion: def.prompt.version,
        usage: result.usage,
        costUsdMicros: result.costUsdMicros,
        latencyMs: Math.round(performance.now() - startedAt),
        repairs: result.repairs,
        attempts: result.attempts,
      },
    });
  } catch (error) {
    await store.markFailed(generation.id, failureOf(error));
    throw error;
  }
}
