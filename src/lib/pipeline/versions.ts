import "server-only";
import type { AssetType } from "@/lib/ai/schemas";
import type { SchemaIssue } from "@/lib/ai/structured";
import { loadContext } from "./generate-asset";
import { registry, type AssetDefinition } from "./registry";
import type { PipelineStore } from "./store";

// Édition manuelle et restauration : versions sans appel au modèle, donc sans crédit. Les Server
// Actions qui les appellent vérifient d'abord le rôle `editor` dans le workspace (ARCHITECTURE §6).

export class AssetValidationError extends Error {
  readonly code = "SCHEMA_INVALID";

  constructor(readonly issues: SchemaIssue[]) {
    super("Le contenu ne respecte pas le format de l'asset");
    this.name = "AssetValidationError";
  }
}

export class VersionNotFoundError extends Error {
  readonly code = "VERSION_NOT_FOUND";

  constructor(versionId: string) {
    super(`Version introuvable : ${versionId}`);
    this.name = "VersionNotFoundError";
  }
}

type Options = { store: PipelineStore; userId: string };

// Le contenu édité passe par les mêmes contrôles qu'une sortie du modèle (schéma et règles du
// pipeline), puis par les mêmes post-traitements (durées, chapitres, tags).
export async function editAsset(pipelineId: string, type: AssetType, content: unknown, { store, userId }: Options): Promise<string> {
  const def = registry[type] as unknown as AssetDefinition<AssetType>;
  const pipeline = await store.getPipeline(pipelineId);
  const { ctx, sourceVersions } = await loadContext(store, pipeline, type);

  const result = def.schema(ctx).safeParse(content);
  if (!result.success) throw new AssetValidationError(result.error.issues.map(({ path, message }) => ({ path, message })));

  return store.commitAssetVersion({
    pipelineId,
    assetType: type,
    content: def.postProcess(result.data, ctx),
    schemaVersion: def.schemaVersion,
    source: "user_edit",
    sourceVersions,
    restoredFrom: null,
    generation: null,
    createdBy: userId,
  });
}

// Restaurer une version crée une copie : l'historique reste immuable et linéaire. La copie garde les
// dépendances de l'original, et l'obsolescence est recalculée par rapport aux versions courantes.
export async function restoreVersion(pipelineId: string, type: AssetType, versionId: string, { store, userId }: Options): Promise<string> {
  const target = await store.getVersion(versionId);
  if (!target || target.pipelineId !== pipelineId || target.assetType !== type) throw new VersionNotFoundError(versionId);

  const current = await store.getCurrentVersion(pipelineId, type);
  if (current?.id === target.id) return target.id;

  return store.commitAssetVersion({
    pipelineId,
    assetType: type,
    content: target.content,
    schemaVersion: registry[type].schemaVersion,
    source: "restore",
    sourceVersions: target.sourceVersions,
    restoredFrom: target.restoredFrom ?? target.id,
    generation: null,
    createdBy: userId,
  });
}
