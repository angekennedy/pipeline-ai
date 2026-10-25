import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetType, Brief, ChannelPreset } from "@/lib/ai/schemas";
import type { ModelTier } from "@/lib/pipeline/registry";
import {
  GenerationInProgressError,
  type CommitInput,
  type GenerationFailure,
  type PipelineStatus,
  type PipelineStore,
  type SourceVersions,
  type StoredVersion,
} from "@/lib/pipeline/store";
import type { Database, Json, Tables } from "./database.types";

type VersionRow = Pick<Tables<"asset_versions">, "id" | "version" | "source" | "content" | "source_versions" | "restored_from" | "created_at">;

const VERSION_COLUMNS = "id, version, source, content, source_versions, restored_from, created_at";
// Jointure vers l'asset parent. Nommée : pipeline_assets.current_version_id est une seconde clé
// étrangère entre les deux tables.
const WITH_ASSET = `${VERSION_COLUMNS}, asset:pipeline_assets!asset_versions_asset_id_fkey!inner(pipeline_id, type)`;
const TERMINAL: readonly PipelineStatus[] = ["completed", "partial", "failed", "canceled"];

type Result = { data: unknown; error: { message: string; code?: string } | null };

// Une erreur PostgREST n'est pas une instance d'Error : on la convertit en gardant son code.
function optional<R extends Result>({ data, error }: R, what: string): R["data"] {
  if (error) throw Object.assign(new Error(`${what} : ${error.message}`), { code: error.code });
  return data;
}

function required<R extends Result>(result: R, what: string): NonNullable<R["data"]> {
  const data = optional(result, what);
  if (data === null || data === undefined) throw new Error(`${what} : aucune donnée`);
  return data;
}

function toStored(row: VersionRow): StoredVersion {
  return {
    id: row.id,
    version: row.version,
    source: row.source,
    content: row.content,
    sourceVersions: row.source_versions as SourceVersions,
    restoredFrom: row.restored_from,
    createdAt: row.created_at,
  };
}

// PipelineStore sur Supabase, en service role (createAdminClient) : réservé au worker Inngest et aux
// Server Actions, après vérification des droits. Les écritures sur plusieurs lignes passent par les
// RPC de la migration 0004, chacune en une transaction.
export class SupabasePipelineStore implements PipelineStore {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async getPipeline(pipelineId: string) {
    const row = optional(
      await this.db.from("pipelines").select("id, workspace_id, brief, channel_snapshot, model_tier").eq("id", pipelineId).maybeSingle(),
      "Lecture du pipeline",
    );
    if (!row) throw new Error(`Pipeline inconnu : ${pipelineId}`);
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      brief: row.brief as Brief, // validé par BriefSchema à la création
      channel: row.channel_snapshot as ChannelPreset | null,
      tier: row.model_tier as ModelTier, // contrainte CHECK (standard, premium)
    };
  }

  async getCurrentVersion(pipelineId: string, assetType: AssetType) {
    const asset = optional(
      await this.db.from("pipeline_assets").select("current_version_id").eq("pipeline_id", pipelineId).eq("type", assetType).maybeSingle(),
      "Lecture de l'asset",
    );
    if (!asset?.current_version_id) return null;
    const row = required(
      await this.db.from("asset_versions").select(VERSION_COLUMNS).eq("id", asset.current_version_id).single(),
      "Lecture de la version courante",
    );
    return toStored(row);
  }

  async listVersions(pipelineId: string, assetType: AssetType) {
    const rows = required(
      await this.db
        .from("asset_versions")
        .select(WITH_ASSET)
        .eq("asset.pipeline_id", pipelineId)
        .eq("asset.type", assetType)
        .order("version", { ascending: false }),
      "Lecture des versions",
    );
    return rows.map(toStored);
  }

  async getVersion(versionId: string) {
    const row = optional(await this.db.from("asset_versions").select(WITH_ASSET).eq("id", versionId).maybeSingle(), "Lecture de la version");
    return row ? { ...toStored(row), pipelineId: row.asset.pipeline_id, assetType: row.asset.type } : null;
  }

  async upsertGeneration(input: { pipelineId: string; assetType: AssetType; idempotencyKey: string; credits: number; userFeedback?: string }) {
    const row = required(
      await this.db.rpc("upsert_generation", {
        p_pipeline: input.pipelineId,
        p_type: input.assetType,
        p_key: input.idempotencyKey,
        p_credits: input.credits,
        p_feedback: input.userFeedback,
      }),
      "Création de la génération",
    );
    return { id: row.id, idempotencyKey: row.idempotency_key, status: row.status, attempt: row.attempt, versionId: row.version_id };
  }

  async markRunning(generationId: string, attempt: number) {
    const claimed = required(await this.db.rpc("claim_generation", { p_generation: generationId, p_attempt: attempt }), "Prise de la génération");
    if (!claimed) throw new GenerationInProgressError(generationId);
  }

  async commitAssetVersion(input: CommitInput) {
    return required(
      await this.db.rpc("commit_asset_version", {
        p_pipeline: input.pipelineId,
        p_type: input.assetType,
        p_content: input.content as Json,
        p_schema_version: input.schemaVersion,
        p_source: input.source,
        p_source_versions: input.sourceVersions as Json,
        p_restored_from: input.restoredFrom ?? undefined,
        p_generation: input.generation?.id,
        p_telemetry: input.generation?.telemetry as Json | undefined,
        p_created_by: input.createdBy ?? undefined,
      }),
      "Enregistrement de la version",
    );
  }

  async markFailed(generationId: string, failure: GenerationFailure) {
    optional(
      await this.db.rpc("mark_generation_failed", {
        p_generation: generationId,
        p_code: failure.code,
        p_message: failure.message,
        p_cost_usd_micros: failure.costUsdMicros ?? undefined,
      }),
      "Échec de la génération",
    );
  }

  async setPipelineStatus(pipelineId: string, status: PipelineStatus) {
    const completedAt = TERMINAL.includes(status) ? new Date().toISOString() : null;
    optional(await this.db.from("pipelines").update({ status, completed_at: completedAt }).eq("id", pipelineId), "Statut du pipeline");
  }
}
