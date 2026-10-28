import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Workspaces internes de l'exploitant (migration 0018) : toutes les fonctionnalités, crédits complétés
// à la demande. Gérés depuis /admin, en service role.

export type InternalWorkspace = { id: string; slug: string; name: string };

export async function listInternalWorkspaces(db: SupabaseClient<Database>): Promise<InternalWorkspace[]> {
  const { data, error } = await db.from("workspaces").select("id, slug, name").eq("is_internal", true).order("slug");
  if (error) throw new Error(`Workspaces internes : ${error.message}`);
  return data;
}

// false : aucun workspace ne porte ce slug.
export async function setInternalWorkspace(db: SupabaseClient<Database>, slug: string, internal: boolean): Promise<boolean> {
  const { data: workspace, error } = await db.from("workspaces").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`Workspace ${slug} : ${error.message}`);
  if (!workspace) return false;
  const { data, error: rpcError } = await db.rpc("set_workspace_internal", { p_workspace: workspace.id, p_internal: internal });
  if (rpcError) throw new Error(`Workspace ${slug} : ${rpcError.message}`);
  return data;
}
