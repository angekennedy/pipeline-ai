import type { Brief } from "@/lib/ai/schemas";
import type { ModelTier } from "@/lib/pipeline/registry";
import { PLANS, PLAN_KEYS, isPlanKey, type PlanKey } from "./plans";

// Ce que le plan interdit (tâche 3.6). Vérifié par la Server Action pour un message immédiat, puis
// en base (migration 0008, PLAN_RESTRICTED) : la RPC de création et le trigger des presets.
export type PlanRestriction =
  | { reason: "subscription_past_due"; plan: PlanKey }
  | { reason: "duration"; plan: PlanKey; limit: number }
  | { reason: "premium"; plan: PlanKey }
  | { reason: "channel_presets"; plan: PlanKey; limit: number };

// Refus d'une action par le plan : l'équivalent d'un 403, avec un message qui dit quoi faire.
export class PlanRestrictionError extends Error {
  readonly code = "PLAN_RESTRICTED";
  readonly status = 403;
  constructor(readonly restriction: PlanRestriction) {
    super(restrictionMessage(restriction));
    this.name = "PlanRestrictionError";
  }
}

// Détail JSON d'une erreur PLAN_RESTRICTED levée en base (RPC de création, trigger des presets).
export function restrictionFromDetails(details: string): PlanRestriction {
  const detail = JSON.parse(details) as PlanRestriction & { plan: string };
  return { ...detail, plan: isPlanKey(detail.plan) ? detail.plan : "free" };
}

// Premier plan, dans l'ordre du catalogue, qui lève la restriction.
const upgradeFor = (test: (plan: (typeof PLANS)[PlanKey]) => boolean) => PLAN_KEYS.map((key) => PLANS[key]).find(test)?.name;

export function restrictionMessage(restriction: PlanRestriction): string {
  const plan = PLANS[restriction.plan].name;
  switch (restriction.reason) {
    case "subscription_past_due":
      return "Le dernier paiement de votre abonnement a échoué : la création de pipelines est suspendue. Vos pipelines restent consultables. Mettez à jour votre moyen de paiement pour la rétablir.";
    case "duration":
      return `Le plan ${plan} limite les vidéos à ${restriction.limit} min. Réduisez la durée, ou passez au plan ${upgradeFor((p) => p.maxDurationMinutes > restriction.limit)} pour aller jusqu'à 60 min.`;
    case "premium":
      return `Le script Premium n'est pas inclus dans le plan ${plan}. Choisissez la formule Standard, ou passez au plan ${upgradeFor((p) => p.premium)}.`;
    case "channel_presets":
      return `Le plan ${plan} est limité à ${restriction.limit} ${restriction.limit > 1 ? "presets de chaîne" : "preset de chaîne"}. Supprimez-en un, ou passez à un plan supérieur.`;
  }
}

// Restriction qui empêche de lancer ce pipeline, dans l'ordre où la base les vérifie.
export function pipelineRestriction(
  planKey: PlanKey,
  brief: Pick<Brief, "durationMinutes">,
  tier: ModelTier,
  { pastDue = false }: { pastDue?: boolean } = {},
): PlanRestriction | null {
  const plan = PLANS[planKey];
  if (pastDue) return { reason: "subscription_past_due", plan: planKey };
  if (brief.durationMinutes > plan.maxDurationMinutes) return { reason: "duration", plan: planKey, limit: plan.maxDurationMinutes };
  if (tier === "premium" && !plan.premium) return { reason: "premium", plan: planKey };
  return null;
}
