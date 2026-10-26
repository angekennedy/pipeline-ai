import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requireUser } from "@/lib/auth/session";
import { creditSummary, type CreditSummary } from "@/lib/billing/balance";
import { isPlanKey } from "@/lib/billing/plans";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

// Appartenance à un workspace, vérifiée dans le layout /w/[workspaceSlug] et dans chaque Server
// Action (ARCHITECTURE §2). Lue sous RLS : un non-membre ne voit pas le workspace et reçoit un 404,
// sans apprendre s'il existe.

export type MemberRole = Database["public"]["Enums"]["member_role"];
export type Membership = { workspace: { id: string; slug: string; name: string }; role: MemberRole; credits: CreditSummary };

const RANK: Record<MemberRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };
export const hasRole = (role: MemberRole, min: MemberRole) => RANK[role] >= RANK[min];

export async function findMembership(db: SupabaseClient<Database>, userId: string, slug: string): Promise<Membership | null> {
  const { data, error } = await db
    .from("workspaces")
    .select("id, slug, name, plan_key, workspace_members!inner(role), credit_accounts(balance, reserved)")
    .eq("slug", slug)
    .eq("workspace_members.user_id", userId)
    .maybeSingle();
  if (error) throw Object.assign(new Error(`Workspace ${slug} : ${error.message}`), { code: error.code });
  const member = data?.workspace_members[0];
  if (!data || !member) return null;
  const account = data.credit_accounts;
  return {
    workspace: { id: data.id, slug: data.slug, name: data.name },
    role: member.role,
    credits: creditSummary(isPlanKey(data.plan_key) ? data.plan_key : "free", account?.balance ?? 0, account?.reserved ?? 0),
  };
}

// Pages : l'utilisateur connecté doit être membre, avec au moins `min`. Sinon 404, comme pour un
// workspace inexistant. Une lecture par requête.
export const requireMembership = cache(async (slug: string, min: MemberRole = "viewer"): Promise<Membership> => {
  const user = await requireUser(`/w/${slug}`);
  const membership = await findMembership(await createClient(), user.id, slug);
  if (!membership || !hasRole(membership.role, min)) notFound();
  return membership;
});
