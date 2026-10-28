import "server-only";
import { cache } from "react";
import { getUser } from "@/lib/auth/session";
import { creditSummary, type CreditSummary } from "@/lib/billing/balance";
import { isPlanKey } from "@/lib/billing/plans";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

// Workspace courant de l'utilisateur, lu sous RLS. En attendant les routes /w/[workspaceSlug]
// (tâche 2.3), c'est son workspace personnel : le plus ancien dont il est owner, créé à l'inscription
// (migration 0009), sinon le plus ancien dont il est membre.

type Role = Database["public"]["Enums"]["member_role"];
export type CurrentWorkspace = { id: string; slug: string; name: string; role: Role; credits: CreditSummary };

export const getCurrentWorkspace = cache(async (): Promise<CurrentWorkspace | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspaces(id, slug, name, plan_key, is_internal, created_at, credit_accounts(balance, reserved))")
    .eq("user_id", user.id);
  if (error) throw Object.assign(new Error(`Workspace courant : ${error.message}`), { code: error.code });

  const [membership] = data
    .flatMap(({ role, workspaces }) => (workspaces ? [{ role, workspace: workspaces }] : []))
    .sort((x, y) => Number(y.role === "owner") - Number(x.role === "owner") || x.workspace.created_at.localeCompare(y.workspace.created_at));
  if (!membership) return null;

  const { workspace, role } = membership;
  const account = workspace.credit_accounts;
  return {
    id: workspace.id,
    slug: workspace.slug,
    name: workspace.name,
    role,
    credits: creditSummary(isPlanKey(workspace.plan_key) ? workspace.plan_key : "free", account?.balance ?? 0, account?.reserved ?? 0, workspace.is_internal),
  };
});

// Pages et Server Actions qui agissent dans un workspace : son absence est une anomalie (le trigger
// d'inscription en crée toujours un).
export async function requireWorkspace(): Promise<CurrentWorkspace> {
  const workspace = await getCurrentWorkspace();
  if (!workspace) throw new Error("Aucun workspace pour cet utilisateur");
  return workspace;
}
