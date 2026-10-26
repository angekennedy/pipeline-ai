import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Suppression du compte (RGPD, tâche 2.6) : abonnements annulés d'abord, puis l'utilisateur et les
// workspaces dont il est le seul owner, en une transaction (RPC delete_account, migration 0010).

export type DeletionBlock =
  | { reason: "workspace_shared"; workspaces: string } // seul owner d'un workspace qui a d'autres membres
  | { reason: "subscription_active" } // abonnement resté actif (annulation non confirmée)
  | { reason: "billing_unavailable" }; // abonnement à annuler, mais Stripe n'est pas branché

export class AccountDeletionBlockedError extends Error {
  constructor(readonly block: DeletionBlock) {
    super(`Suppression du compte bloquée : ${block.reason}`); // message affiché : Settings.errors
    this.name = "AccountDeletionBlockedError";
  }
}


// Annule immédiatement ces abonnements chez Stripe. Rejette si l'un d'eux n'a pas pu l'être.
export type SubscriptionCanceler = (subscriptionIds: string[]) => Promise<void>;

// Tant que Stripe n'est pas branché (tâches 3.3 et 3.4), aucun abonnement ne peut être créé. S'il en
// existe un malgré tout, le compte n'est pas supprimé : il resterait facturé.
export const stripeNotConfigured: SubscriptionCanceler = async (ids) => {
  if (ids.length > 0) throw new AccountDeletionBlockedError({ reason: "billing_unavailable" });
};

const ENDED = ["canceled", "incomplete_expired"];

// Abonnements encore actifs des workspaces qui seront supprimés avec le compte.
async function subscriptionsToCancel(admin: SupabaseClient<Database>, userId: string): Promise<string[]> {
  const { data: owned, error } = await admin.from("workspace_members").select("workspace_id").eq("user_id", userId).eq("role", "owner");
  if (error) throw new Error(`Workspaces de ${userId} : ${error.message}`);
  if (owned.length === 0) return [];
  const ids = owned.map((row) => row.workspace_id);

  const { data: owners, error: ownersError } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .in("workspace_id", ids)
    .eq("role", "owner")
    .neq("user_id", userId);
  if (ownersError) throw new Error(`Propriétaires des workspaces de ${userId} : ${ownersError.message}`);
  const coOwned = new Set(owners.map((row) => row.workspace_id));
  const soleOwned = ids.filter((id) => !coOwned.has(id));
  if (soleOwned.length === 0) return [];

  const { data: subscriptions, error: subscriptionsError } = await admin
    .from("subscriptions")
    .select("id, status")
    .in("workspace_id", soleOwned);
  if (subscriptionsError) throw new Error(`Abonnements de ${userId} : ${subscriptionsError.message}`);
  return subscriptions.filter((s) => !ENDED.includes(s.status)).map((s) => s.id);
}

// Renvoie le nombre de workspaces supprimés. Service role : appelée par la Server Action après
// vérification de l'utilisateur et de sa confirmation.
export async function deleteAccount(
  admin: SupabaseClient<Database>,
  userId: string,
  { cancelSubscriptions = stripeNotConfigured }: { cancelSubscriptions?: SubscriptionCanceler } = {},
): Promise<number> {
  const subscriptions = await subscriptionsToCancel(admin, userId);
  if (subscriptions.length > 0) {
    await cancelSubscriptions(subscriptions);
    // Annulés chez Stripe : la base les voit terminés sans attendre le webhook.
    const { error } = await admin.from("subscriptions").update({ status: "canceled", updated_at: new Date().toISOString() }).in("id", subscriptions);
    if (error) throw new Error(`Abonnements annulés de ${userId} : ${error.message}`);
  }

  const { data, error } = await admin.rpc("delete_account", { p_user: userId });
  if (error) {
    if (error.message === "WORKSPACE_SHARED") throw new AccountDeletionBlockedError({ reason: "workspace_shared", workspaces: error.details });
    if (error.message === "SUBSCRIPTION_ACTIVE") throw new AccountDeletionBlockedError({ reason: "subscription_active" });
    throw Object.assign(new Error(`Suppression du compte ${userId} : ${error.message}`), { code: error.code });
  }
  return data;
}
