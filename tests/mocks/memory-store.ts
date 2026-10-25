import { randomUUID } from "node:crypto";
import type { AssetType } from "@/lib/ai/schemas";
import type {
  CommitInput,
  GenerationFailure,
  GenerationRecord,
  GenerationTelemetry,
  PipelineRecord,
  PipelineStatus,
  PipelineStore,
  SourceVersions,
  StoredVersion,
  VersionSource,
} from "@/lib/pipeline/store";

type Generation = GenerationRecord & {
  pipelineId: string;
  assetType: AssetType;
  credits: number;
  userFeedback?: string;
  telemetry?: GenerationTelemetry;
  failure?: GenerationFailure;
};

type Version = StoredVersion & {
  pipelineId: string;
  assetType: AssetType;
  schemaVersion: string;
  generationId: string | null;
  createdBy: string | null;
};

// PipelineStore en mémoire, avec les mêmes garanties que l'implémentation Supabase attendue :
// génération unique par clé, versions immuables numérotées par asset, commit atomique.
export class MemoryPipelineStore implements PipelineStore {
  readonly pipelines = new Map<string, PipelineRecord>();
  readonly generations = new Map<string, Generation>(); // par clé d'idempotence
  readonly versions: Version[] = [];
  readonly statuses: Array<[string, PipelineStatus]> = []; // historique des changements de statut
  private readonly current = new Map<string, string>(); // `${pipelineId}:${type}` → id de version
  private clock = Date.parse("2026-10-24T10:00:00.000Z"); // horodatage croissant et déterministe

  addPipeline(pipeline: PipelineRecord) {
    this.pipelines.set(pipeline.id, pipeline);
    return pipeline;
  }

  // Version déjà présente (par exemple un script), sans passer par generateAsset.
  seedVersion(
    pipelineId: string,
    assetType: AssetType,
    content: unknown,
    { source = "ai", sourceVersions = {} }: { source?: VersionSource; sourceVersions?: SourceVersions } = {},
  ): string {
    return this.insert({ pipelineId, assetType, content, schemaVersion: `${assetType}@1`, source, sourceVersions, restoredFrom: null, generation: null, createdBy: null });
  }

  generation(key: string): Generation {
    const generation = this.generations.get(key);
    if (!generation) throw new Error(`Génération inconnue : ${key}`);
    return generation;
  }

  private byId(generationId: string): Generation {
    const generation = [...this.generations.values()].find((g) => g.id === generationId);
    if (!generation) throw new Error(`Génération inconnue : ${generationId}`);
    return generation;
  }

  private insert({ content, generation, ...input }: CommitInput): string {
    const version = this.versions.filter((v) => v.pipelineId === input.pipelineId && v.assetType === input.assetType).length + 1;
    const id = randomUUID();
    this.clock += 1000;
    this.versions.push({
      ...input,
      id,
      version,
      content: structuredClone(content),
      generationId: generation?.id ?? null,
      createdAt: new Date(this.clock).toISOString(),
    });
    this.current.set(`${input.pipelineId}:${input.assetType}`, id);
    return id;
  }

  private toStored({ id, version, source, content, sourceVersions, restoredFrom, createdAt }: Version): StoredVersion {
    return { id, version, source, content: structuredClone(content), sourceVersions: { ...sourceVersions }, restoredFrom, createdAt };
  }

  async getPipeline(pipelineId: string) {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) throw new Error(`Pipeline inconnu : ${pipelineId}`);
    return structuredClone(pipeline);
  }

  async getCurrentVersion(pipelineId: string, assetType: AssetType) {
    const id = this.current.get(`${pipelineId}:${assetType}`);
    const version = this.versions.find((v) => v.id === id);
    return version ? this.toStored(version) : null;
  }

  async listVersions(pipelineId: string, assetType: AssetType) {
    return this.versions
      .filter((v) => v.pipelineId === pipelineId && v.assetType === assetType)
      .sort((a, b) => b.version - a.version)
      .map((v) => this.toStored(v));
  }

  async getVersion(versionId: string) {
    const version = this.versions.find((v) => v.id === versionId);
    return version ? { ...this.toStored(version), pipelineId: version.pipelineId, assetType: version.assetType } : null;
  }

  async upsertGeneration(input: { pipelineId: string; assetType: AssetType; idempotencyKey: string; credits: number; userFeedback?: string }) {
    const existing = this.generations.get(input.idempotencyKey);
    if (existing) return { ...existing };
    const generation: Generation = { ...input, id: randomUUID(), status: "queued", attempt: 0, versionId: null };
    this.generations.set(input.idempotencyKey, generation);
    return { ...generation };
  }

  async markRunning(generationId: string, attempt: number) {
    Object.assign(this.byId(generationId), { status: "running", attempt, failure: undefined });
  }

  async commitAssetVersion(input: CommitInput) {
    const generation = input.generation && this.byId(input.generation.id);
    const id = this.insert(input);
    if (generation) Object.assign(generation, { status: "succeeded", versionId: id, telemetry: input.generation!.telemetry });
    return id;
  }

  async markFailed(generationId: string, failure: GenerationFailure) {
    Object.assign(this.byId(generationId), { status: "failed", failure });
  }

  async setPipelineStatus(pipelineId: string, status: PipelineStatus) {
    this.statuses.push([pipelineId, status]);
  }
}
