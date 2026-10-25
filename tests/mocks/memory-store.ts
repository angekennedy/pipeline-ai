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
  StoredVersion,
} from "@/lib/pipeline/store";

type Generation = GenerationRecord & {
  pipelineId: string;
  assetType: AssetType;
  credits: number;
  telemetry?: GenerationTelemetry;
  failure?: GenerationFailure;
};

type Version = StoredVersion & Omit<CommitInput, "content" | "telemetry"> & { version: number };

// PipelineStore en mémoire, avec les mêmes garanties que l'implémentation Supabase attendue :
// génération unique par clé, versions immuables numérotées par asset, commit atomique.
export class MemoryPipelineStore implements PipelineStore {
  readonly pipelines = new Map<string, PipelineRecord>();
  readonly generations = new Map<string, Generation>(); // par clé d'idempotence
  readonly versions: Version[] = [];
  readonly statuses: Array<[string, PipelineStatus]> = []; // historique des changements de statut
  private readonly current = new Map<string, string>(); // `${pipelineId}:${type}` → id de version

  addPipeline(pipeline: PipelineRecord) {
    this.pipelines.set(pipeline.id, pipeline);
    return pipeline;
  }

  // Version déjà générée (par exemple un script), sans passer par generateAsset.
  seedVersion(pipelineId: string, assetType: AssetType, content: unknown): string {
    const id = randomUUID();
    this.versions.push({ id, content, pipelineId, assetType, version: 1, generationId: "seed", schemaVersion: `${assetType}@1`, sourceScriptVersionId: null });
    this.current.set(`${pipelineId}:${assetType}`, id);
    return id;
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

  async getPipeline(pipelineId: string) {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) throw new Error(`Pipeline inconnu : ${pipelineId}`);
    return structuredClone(pipeline);
  }

  async getCurrentVersion(pipelineId: string, assetType: AssetType) {
    const id = this.current.get(`${pipelineId}:${assetType}`);
    const version = this.versions.find((v) => v.id === id);
    return version ? { id: version.id, content: structuredClone(version.content) } : null;
  }

  async upsertGeneration(input: { pipelineId: string; assetType: AssetType; idempotencyKey: string; credits: number }) {
    const existing = this.generations.get(input.idempotencyKey);
    if (existing) return { ...existing };
    const generation: Generation = { ...input, id: randomUUID(), status: "queued", attempt: 0, versionId: null };
    this.generations.set(input.idempotencyKey, generation);
    return { ...generation };
  }

  async markRunning(generationId: string, attempt: number) {
    Object.assign(this.byId(generationId), { status: "running", attempt, failure: undefined });
  }

  async commitAssetVersion({ content, telemetry, ...input }: CommitInput) {
    const generation = this.byId(input.generationId);
    const version = this.versions.filter((v) => v.pipelineId === input.pipelineId && v.assetType === input.assetType).length + 1;
    const id = randomUUID();
    this.versions.push({ ...input, id, version, content: structuredClone(content) });
    this.current.set(`${input.pipelineId}:${input.assetType}`, id);
    Object.assign(generation, { status: "succeeded", versionId: id, telemetry });
    return id;
  }

  async markFailed(generationId: string, failure: GenerationFailure) {
    Object.assign(this.byId(generationId), { status: "failed", failure });
  }

  async setPipelineStatus(pipelineId: string, status: PipelineStatus) {
    this.statuses.push([pipelineId, status]);
  }
}
