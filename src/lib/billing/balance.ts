import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { isPlanKey, PLANS, type Plan, type PlanKey } from "./plans";

// Solde affiché dans le badge et comparé au coût avant le lancement. Le disponible est ce que la
// réservation peut encore prendre : balance − reserved (credit_op, migration 0004).
// `unlimited` : workspace interne de l'exploitant (migration 0018), complété à la demande.
export type CreditSummary = { planKey: PlanKey; balance: number; reserved: number; available: number; unlimited: boolean };

export const creditSummary = (planKey: PlanKey, balance: number, reserved = 0, unlimited = false): CreditSummary => ({
  planKey,
  balance,
  reserved,
  available: balance - reserved,
  unlimited,
});

// Droits appliqués : ceux du plan, ou tous (ceux de Studio, le plan le plus complet) pour un
// workspace interne. La base fait la même exception (create_pipeline_with_reservation).
export const effectivePlan = (credits: Pick<CreditSummary, "planKey" | "unlimited">): Plan => (credits.unlimited ? PLANS.studio : PLANS[credits.planKey]);

// Lecture sous RLS (client de l'utilisateur) ou en service role. Un workspace sans compte de crédits
// n'a encore rien reçu : solde nul. Un plan inconnu retombe sur Free, le plus restrictif.
export async function getCreditSummary(db: SupabaseClient<Database>, workspaceId: string): Promise<CreditSummary> {
  const { data, error } = await db
    .from("workspaces")
    .select("plan_key, is_internal, credit_accounts(balance, reserved)")
    .eq("id", workspaceId)
    .single();
  if (error) throw Object.assign(new Error(`Solde de crédits : ${error.message}`), { code: error.code });
  const account = data.credit_accounts;
  return creditSummary(isPlanKey(data.plan_key) ? data.plan_key : "free", account?.balance ?? 0, account?.reserved ?? 0, data.is_internal);
}
