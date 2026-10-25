import type { UsageTotals } from "@/lib/ai/structured";
import type { AssetType, Brief, ChannelPreset } from "@/lib/ai/schemas";
import type { ModelTier } from "./registry";

// Accès aux données du pipeline, découplé de Supabase : lib/pipeline ne dépend ni de la base ni
// d'Inngest. L'implémentation Supabase (service role, RPC transactionnelles) vient avec les migrations.

export type PipelineRecord = {
  id: string;
  workspaceId: string;
  brief: Brief;
  channel: ChannelPreset | null; // `pipelines.channel_snapshot`
  tier: ModelTier;
};

// Statuts de `pipelines.status`. `canceled` est posé par la Server Action qui annule le pipeline.
export type PipelineStatus = "queued" | "running" | "completed" | "partial" | "failed" | "canceled";

export type GenerationStatus = "queued" | "running" | "succeeded" | "failed";

export type GenerationRecord = {
  id: string;
  idempotencyKey: string;
  status: GenerationStatus;
  attempt: number;
  versionId: string | null; // renseigné quand status = succeeded
};

export type StoredVersion = { id: string; content: unknown };

export type GenerationTelemetry = {
  model: string;
  promptVersion: string;
  usage: UsageTotals;
  costUsdMicros: number | null;
  latencyMs: number;
  repairs: number;
  attempts: number; // appels à l'API pendant cette tentative (réparation, relance sur max_tokens)
};

export type CommitInput = {
  generationId: string;
  pipelineId: string;
  assetType: AssetType;
  content: unknown;
  schemaVersion: string;
  sourceScriptVersionId: string | null; // dérivés : version du script utilisée
  telemetry: GenerationTelemetry;
};

export type GenerationFailure = {
  code: string;
  message: string;
  costUsdMicros: number | null; // un appel refusé ou invalide reste facturé par l'API
};

export interface PipelineStore {
  getPipeline(pipelineId: string): Promise<PipelineRecord>;
  getCurrentVersion(pipelineId: string, assetType: AssetType): Promise<StoredVersion | null>;
  // Crée la génération, ou renvoie celle qui porte déjà cette clé (`unique(idempotency_key)`).
  upsertGeneration(input: {
    pipelineId: string;
    assetType: AssetType;
    idempotencyKey: string;
    credits: number;
  }): Promise<GenerationRecord>;
  markRunning(generationId: string, attempt: number): Promise<void>;
  // Une seule transaction : version immuable, pointeur courant, statut et télémétrie de la génération.
  // Renvoie l'id de la version créée.
  commitAssetVersion(input: CommitInput): Promise<string>;
  markFailed(generationId: string, failure: GenerationFailure): Promise<void>;
  setPipelineStatus(pipelineId: string, status: PipelineStatus): Promise<void>;
}
