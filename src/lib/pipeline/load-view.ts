import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSET_TYPES, type AssetType, type Brief } from "@/lib/ai/schemas";
import type { Database } from "@/lib/supabase/database.types";
import type { AssetContent, ModelTier } from "./registry";
import { regenerationCredits, staleAssets, type CurrentVersions } from "./staleness";
import type { PipelineStatus, SourceVersions, VersionSource } from "./store";
import { MEDIA_BUCKET } from "@/lib/media/storage";
import { VideoManifestSchema } from "@/lib/video/manifest";
import type { AssetView, AssetViewStatus, PipelineAssets, PipelineView, VideoView } from "./view";

// Vue d'un pipeline lue en base (page /w/[workspaceSlug]/pipelines/[pipelineId]). À appeler avec le
// client de l'utilisateur : la RLS limite la lecture à ses workspaces, et un pipeline d'un autre
// workspace donne null (404).

const TERMINAL: ReadonlySet<PipelineStatus> = new Set(["completed", "partial", "failed", "canceled"]);


export async function loadPipelineView(db: SupabaseClient<Database>, workspaceId: string, pipelineId: string): Promise<PipelineView | null> {
  const pipeline = check(
    await db.from("pipelines").select("id, brief, model_tier, status, created_at, channel_name:channel_snapshot->>name").eq("id", pipelineId).eq("workspace_id", workspaceId).maybeSingle(),
    "Pipeline",
  );
  if (!pipeline) return null;

  const [assets, versions, failures, regenerations] = await Promise.all([
    db.from("pipeline_assets").select("type, status, current_version_id").eq("pipeline_id", pipelineId),
    db
      .from("asset_versions")
      .select("id, version, source, content, source_versions, restored_from, created_at, asset:pipeline_assets!asset_versions_asset_id_fkey!inner(pipeline_id, type)")
      .eq("asset.pipeline_id", pipelineId)
      .order("version", { ascending: false }),
    db.from("generations").select("asset_type, error_code, created_at").eq("pipeline_id", pipelineId).eq("status", "failed").order("created_at", { ascending: false }),
    // Régénérations demandées et pas encore terminées : l'asset s'affiche en cours.
    db.from("generations").select("asset_type").eq("pipeline_id", pipelineId).like("idempotency_key", "regen:%").in("status", ["queued", "running"]),
  ]);
  const assetRows = check(assets, "Assets") ?? [];
  const versionRows = check(versions, "Versions") ?? [];
  const failureRows = check(failures, "Générations") ?? [];
  const regenerating = new Set((check(regenerations, "Régénérations") ?? []).map((g) => g.asset_type));

  const brief = pipeline.brief as Brief; // validé par BriefSchema à la création
  const tier = pipeline.model_tier as ModelTier; // contrainte CHECK (standard, premium)
  const status = pipeline.status as PipelineStatus;

  const current: CurrentVersions = {};
  const views = {} as Record<AssetType, AssetView<AssetType>>;
  for (const type of ASSET_TYPES) {
    const row = assetRows.find((a) => a.type === type);
    const history = versionRows.filter((v) => v.asset.type === type);
    const version = history.find((v) => v.id === row?.current_version_id) ?? null;
    current[type] = version && { id: version.id, sourceVersions: version.source_versions as SourceVersions, restoredFrom: version.restored_from };

    const failure = failureRows.find((g) => g.asset_type === type);
    const viewStatus = regenerating.has(type) ? "running" : assetStatus(row?.status, Boolean(version), TERMINAL.has(status));
    views[type] = {
      status: viewStatus,
      content: viewStatus === "ready" && version ? (version.content as AssetContent[AssetType]) : null,
      error: viewStatus === "failed" ? failureView(failure?.error_code ?? null) : null,
      stale: false,
      versions: history.map((v) => ({ id: v.id, version: v.version, source: v.source as VersionSource, createdAt: v.created_at })),
    };
  }

  const stale = staleAssets(current);
  for (const type of stale) views[type].stale = true;

  let video: VideoView | undefined;
  if (brief.video) {
    const row = assetRows.find((a) => a.type === "video");
    const version = versionRows.find((v) => v.id === row?.current_version_id) ?? null;
    const videoStatus = assetStatus(row?.status, Boolean(version), TERMINAL.has(status));
    const manifest = version ? VideoManifestSchema.safeParse(version.content) : null;
    video = {
      status: videoStatus,
      content: videoStatus === "ready" && manifest?.success ? manifest.data : null,
      error: videoStatus === "failed" ? failureView(failureRows.find((g) => g.asset_type === "video")?.error_code ?? null) : null,
    };
  }
  const thumbnails = views.thumbnails.content as AssetContent["thumbnails"] | null;
  const media = await signMedia(db, (thumbnails?.concepts ?? []).flatMap((concept) => (concept.imagePath ? [concept.imagePath] : [])));

  return {
    id: pipeline.id,
    brief,
    tier,
    status,
    createdAt: pipeline.created_at,
    assets: views as PipelineAssets,
    staleCredits: regenerationCredits(stale, brief, tier),
    ...(typeof pipeline.channel_name === "string" && { channelName: pipeline.channel_name }),
    ...(video && { video }),
    ...(Object.keys(media).length > 0 && { media }),
  };
}

// Liens signés avec le client de l'utilisateur : la policy du bucket limite la lecture aux membres du
// workspace. Un échec n'empêche pas d'afficher le pipeline (les concepts restent lisibles).
async function signMedia(db: SupabaseClient<Database>, paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await db.storage.from(MEDIA_BUCKET).createSignedUrls(paths, 3600);
  if (error || !data) return {};
  return Object.fromEntries(data.flatMap((entry) => (entry.path && entry.signedUrl && !entry.error ? [[entry.path, entry.signedUrl]] : [])));
}

// Un asset encore `pending` dans un pipeline terminé n'a pas été lancé : une dépendance a échoué.
function assetStatus(stored: string | undefined, hasVersion: boolean, pipelineDone: boolean): AssetViewStatus {
  if (hasVersion && stored !== "running") return "ready";
  switch (stored) {
    case "running":
      return "running";
    case "failed":
      return "failed";
    default:
      return pipelineDone ? "skipped" : "pending";
  }
}

// Code de l'échec, affiché par un message prévu (Failures) ; le message technique (fournisseur, erreur
// interne) reste dans `generations` et dans Sentry.
const failureView = (code: string | null) => ({ code: code ?? "INTERNAL" });

type Result<T> = { data: T; error: { message: string; code?: string } | null };
function check<T>({ data, error }: Result<T>, what: string): T {
  if (error) throw Object.assign(new Error(`${what} : ${error.message}`), { code: error.code });
  return data;
}
