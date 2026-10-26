import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { validBrief, validScript, validSeo, validThumbnails, validTitles, validVoiceover } from "../fixtures/assets";
import { userIdFor } from "./auth";

// Pipeline terminé en base, pour les parcours qui partent d'un résultat (édition, régénération,
// exports) : sans Anthropic, les versions viennent des fixtures, écrites par les vraies RPC.
function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}

const ASSETS = [
  ["script", validScript, []],
  ["titles", validTitles, ["script"]],
  ["seo", validSeo, ["script"]],
  ["voiceover", validVoiceover, ["script"]],
  ["thumbnails", validThumbnails, ["script", "titles"]],
] as const;

export async function seedCompletedPipeline(email: string): Promise<{ workspaceSlug: string; pipelineId: string; path: string }> {
  const db = admin();
  const userId = userIdFor(email);
  const { data: membership, error } = await db.from("workspace_members").select("workspaces(id, slug)").eq("user_id", userId).eq("role", "owner").single();
  if (error) throw error;
  const workspace = membership.workspaces as unknown as { id: string; slug: string };

  const { data: created, error: createError } = await db.rpc("create_pipeline_with_reservation", {
    p_workspace: workspace.id,
    p_user: userId,
    p_brief: validBrief,
    p_tier: "standard",
    p_credits: 18,
    p_key: randomUUID(),
  });
  if (createError) throw createError;
  const pipelineId = (created as Array<{ pipeline_id: string }>)[0]!.pipeline_id;

  const versions: Record<string, string> = {};
  for (const [type, content, deps] of ASSETS) {
    const { data, error: commitError } = await db.rpc("commit_asset_version", {
      p_pipeline: pipelineId,
      p_type: type,
      p_content: content,
      p_schema_version: `${type}@1`,
      p_source: "ai",
      p_source_versions: Object.fromEntries(deps.map((dep) => [dep, versions[dep]])),
    });
    if (commitError) throw commitError;
    versions[type] = data as string;
  }
  // Sans génération, rien n'est capturé : la réservation est rendue en entier.
  const { error: finalizeError } = await db.rpc("finalize_pipeline", { p_pipeline: pipelineId, p_status: "completed" });
  if (finalizeError) throw finalizeError;
  return { workspaceSlug: workspace.slug, pipelineId, path: `/w/${workspace.slug}/pipelines/${pipelineId}` };
}
