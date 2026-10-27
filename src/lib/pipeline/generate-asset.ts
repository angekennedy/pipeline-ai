import "server-only";
import { OpenAIError, type OpenAIClient } from "@/lib/ai/openai";
import type { PromptContext } from "@/lib/ai/prompts";
import { assetSchemas, type AssetType, type Script, type Titles } from "@/lib/ai/schemas";
import { LlmError, callStructured } from "@/lib/ai/structured";
import { createSceneThrottle, safePublish } from "@/lib/realtime/broadcast";
import type { PipelineEventPublisher } from "@/lib/realtime/events";
import { registry, type AssetDefinition } from "./registry";
import { GenerationInProgressError, type GenerationFailure, type PipelineRecord, type PipelineStore, type SourceVersions } from "./store";

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
  client?: OpenAIClient;
  onText?: (delta: string, snapshot: string) => void;
  // Affichage en direct (Realtime Broadcast), sans effet sur le résultat si l'envoi échoue.
  publish?: PipelineEventPublisher;
  // Régénération demandée par l'utilisateur : génération distincte (clé `regen:<nonce>`) et
  // consigne libre, transmise au modèle comme donnée non fiable.
  regeneration?: { key: string; feedback?: string };
  signal?: AbortSignal;
};

export const generationKey = (pipelineId: string, type: AssetType) => `pipe:${pipelineId}:${type}`;

// Contexte d'un asset : brief, preset et version courante de chaque dépendance. Partagé par la
// génération et l'édition manuelle.
export async function loadContext(store: PipelineStore, pipeline: PipelineRecord, type: AssetType) {
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
  // Chaque dépendance est enregistrée par son origine : une copie restaurée vaut sa version d'origine.
  const sourceVersions: SourceVersions = Object.fromEntries(deps.map(([dep, version]) => [dep, version!.restoredFrom ?? version!.id]));
  return { ctx, sourceVersions };
}

function failureOf(error: unknown): GenerationFailure {
  if (error instanceof LlmError) return { code: error.code, message: error.message, costUsdMicros: error.costUsdMicros };
  if (error instanceof MissingDependencyError) return { code: error.code, message: error.message, costUsdMicros: null };
  if (error instanceof OpenAIError) return { code: "PROVIDER_ERROR", message: error.message, costUsdMicros: null };
  return { code: "INTERNAL", message: error instanceof Error ? error.message : String(error), costUsdMicros: null };
}

// Cœur idempotent d'une étape du pipeline. Rejouée après un succès (retry Inngest, double envoi),
// elle renvoie la version déjà enregistrée sans rappeler le modèle. Renvoie l'id de version : le
// contenu reste en base, hors de l'état des étapes Inngest.
export async function generateAsset(pipelineId: string, type: AssetType, options: GenerateAssetOptions): Promise<string> {
  const { store, publish, regeneration } = options;
  // Vue non corrélée : schema(ctx) et postProcess portent le même type d'asset, ce que TypeScript
  // ne sait pas relier à travers l'union des clés.
  const def = registry[type] as unknown as AssetDefinition<AssetType>;
  const pipeline = await store.getPipeline(pipelineId);
  const generation = await store.upsertGeneration({
    pipelineId,
    assetType: type,
    idempotencyKey: regeneration?.key ?? generationKey(pipelineId, type),
    credits: def.credits(pipeline.brief, pipeline.tier),
    userFeedback: regeneration?.feedback,
  });
  if (generation.status === "succeeded" && generation.versionId) return generation.versionId;

  // Seul le script est assez long pour mériter un affichage scène par scène.
  const scenes = type === "script" && publish ? createSceneThrottle(publish) : null;
  try {
    const loaded = await loadContext(store, pipeline, type);
    const ctx: PromptContext = { ...loaded.ctx, feedback: regeneration?.feedback };
    await store.markRunning(generation.id, generation.attempt + 1);
    await safePublish(publish, { type: "asset.started", asset: type });

    const prompt = def.prompt.build(ctx);
    const startedAt = performance.now();
    const result = await callStructured(
      {
        modelKey: def.modelKey(pipeline.tier),
        system: prompt.system,
        messages: prompt.messages,
        schema: (def.outputSchema ?? def.schema)(ctx),
        maxTokens: def.maxTokens(pipeline.brief),
        onText:
          scenes || options.onText
            ? (delta, snapshot) => {
                scenes?.onText(delta, snapshot);
                options.onText?.(delta, snapshot);
              }
            : undefined,
        signal: options.signal,
      },
      options.client ? { client: options.client } : {},
    );

    await scenes?.flush();

    const versionId = await store.commitAssetVersion({
      pipelineId,
      assetType: type,
      content: def.postProcess(result.data, ctx),
      schemaVersion: def.schemaVersion,
      source: regeneration ? "ai_regen" : "ai",
      sourceVersions: loaded.sourceVersions,
      restoredFrom: null,
      createdBy: null,
      generation: {
        id: generation.id,
        telemetry: {
          model: result.model,
          promptVersion: def.prompt.version,
          usage: result.usage,
          costUsdMicros: result.costUsdMicros,
          latencyMs: Math.round(performance.now() - startedAt),
          repairs: result.repairs,
          attempts: result.attempts,
        },
      },
    });
    await safePublish(publish, { type: "asset.completed", asset: type, versionId });
    return versionId;
  } catch (error) {
    scenes?.cancel();
    // La génération appartient à l'autre exécution : ne pas la marquer en échec à sa place.
    if (error instanceof GenerationInProgressError) throw error;
    const failure = failureOf(error);
    await store.markFailed(generation.id, failure);
    await safePublish(publish, { type: "asset.failed", asset: type, code: failure.code });
    throw error;
  }
}
