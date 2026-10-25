import type { UsageTotals } from "@/lib/ai/structured";
import type { AssetType, Brief, ChannelPreset } from "@/lib/ai/schemas";
import type { ModelTier } from "./registry";
import type { PipelineStatus } from "./status";

// Accès aux données du pipeline, découplé de Supabase : lib/pipeline ne dépend ni de la base ni
// d'Inngest. Implémentation Supabase : src/lib/supabase/pipeline-store.ts (service role, RPC transactionnelles).

export type PipelineRecord = {
  id: string;
  workspaceId: string;
  brief: Brief;
  channel: ChannelPreset | null; // `pipelines.channel_snapshot`
  tier: ModelTier;
};

export type { PipelineStatus } from "./status";

export type GenerationStatus = "queued" | "running" | "succeeded" | "failed";

export type GenerationRecord = {
  id: string;
  idempotencyKey: string;
  status: GenerationStatus;
  attempt: number;
  versionId: string | null; // renseigné quand status = succeeded
};

// Origine d'une version (`version_source`). Une restauration crée une nouvelle version, copie d'une
// ancienne : l'historique reste linéaire et immuable.
export type VersionSource = "ai" | "ai_regen" | "user_edit" | "restore";

// Version de chaque dépendance utilisée pour produire le contenu : sert au calcul d'obsolescence.
export type SourceVersions = Partial<Record<AssetType, string>>;

export type StoredVersion = {
  id: string;
  version: number; // numéro croissant par asset, à partir de 1
  source: VersionSource;
  content: unknown;
  sourceVersions: SourceVersions;
  // Restauration : version d'origine du contenu copié. L'obsolescence compare les origines, pour
  // qu'un dérivé produit à partir de cette version redevienne à jour quand on la restaure.
  restoredFrom: string | null;
  createdAt: string; // ISO 8601
};

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
  pipelineId: string;
  assetType: AssetType;
  content: unknown;
  schemaVersion: string;
  source: VersionSource;
  sourceVersions: SourceVersions;
  restoredFrom: string | null;
  generation: { id: string; telemetry: GenerationTelemetry } | null; // null : édition ou restauration
  createdBy: string | null; // utilisateur à l'origine d'une édition ou d'une restauration
};

export type GenerationFailure = {
  code: string;
  message: string;
  costUsdMicros: number | null; // un appel refusé ou invalide reste facturé par l'API
};

// Une autre exécution tient déjà la génération (bail en cours). Erreur retentable : au retry, la
// génération est soit terminée (version renvoyée), soit libérée par l'expiration du bail.
export class GenerationInProgressError extends Error {
  readonly code = "GENERATION_IN_PROGRESS";
  readonly retryable = true;
  constructor(generationId: string) {
    super(`Génération ${generationId} déjà en cours dans une autre exécution`);
    this.name = "GenerationInProgressError";
  }
}

export interface PipelineStore {
  getPipeline(pipelineId: string): Promise<PipelineRecord>;
  getCurrentVersion(pipelineId: string, assetType: AssetType): Promise<StoredVersion | null>;
  listVersions(pipelineId: string, assetType: AssetType): Promise<StoredVersion[]>; // la plus récente d'abord
  getVersion(versionId: string): Promise<(StoredVersion & { pipelineId: string; assetType: AssetType }) | null>;
  // Crée la génération, ou renvoie celle qui porte déjà cette clé (`unique(idempotency_key)`).
  upsertGeneration(input: {
    pipelineId: string;
    assetType: AssetType;
    idempotencyKey: string;
    credits: number;
    userFeedback?: string; // consigne de régénération (`generations.user_feedback`, non fiable)
  }): Promise<GenerationRecord>;
  // Prend la génération pour cette tentative ; GenerationInProgressError si une autre la tient.
  markRunning(generationId: string, attempt: number): Promise<void>;
  // Une seule transaction : version immuable, pointeur courant et, pour une génération, son statut
  // et sa télémétrie. Renvoie l'id de la version créée.
  commitAssetVersion(input: CommitInput): Promise<string>;
  markFailed(generationId: string, failure: GenerationFailure): Promise<void>;
  setPipelineStatus(pipelineId: string, status: PipelineStatus): Promise<void>;
}
