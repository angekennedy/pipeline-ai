import type { Translator } from "@/i18n/types";
import type { Brief } from "@/lib/ai/schemas";
import type { ModelTier } from "@/lib/pipeline/registry";
import { PLANS, PLAN_KEYS, isPlanKey, type PlanKey } from "./plans";

// Ce que le plan interdit (tâche 3.6). Vérifié par la Server Action pour un message immédiat, puis
// en base (migration 0008, PLAN_RESTRICTED) : la RPC de création et le trigger des presets.
export type PlanRestriction =
  | { reason: "subscription_past_due"; plan: PlanKey }
  | { reason: "duration"; plan: PlanKey; limit: number }
  | { reason: "premium"; plan: PlanKey }
  | { reason: "video"; plan: PlanKey }
  | { reason: "channel_presets"; plan: PlanKey; limit: number };

// Refus d'une action par le plan : l'équivalent d'un 403, avec un message qui dit quoi faire.
export class PlanRestrictionError extends Error {
  readonly code = "PLAN_RESTRICTED";
  readonly status = 403;
  constructor(readonly restriction: PlanRestriction) {
    super(`Restriction du plan ${restriction.plan} : ${restriction.reason}`);
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

// Message affiché, dans la langue de l'interface (Restriction) : ce que le plan interdit et quoi faire.
export function restrictionMessage(restriction: PlanRestriction, t: Translator<"Restriction">): string {
  const plan = PLANS[restriction.plan].name;
  switch (restriction.reason) {
    case "subscription_past_due":
      return t("subscription_past_due");
    case "duration":
      return t("duration", { plan, limit: restriction.limit, upgrade: upgradeFor((p) => p.maxDurationMinutes > restriction.limit) ?? "" });
    case "premium":
      return t("premium", { plan, upgrade: upgradeFor((p) => p.premium) ?? "" });
    case "video":
      return t("video", { plan, upgrade: upgradeFor((p) => p.video) ?? "" });
    case "channel_presets":
      return t("channel_presets", { plan, limit: restriction.limit });
  }
}

// Restriction qui empêche de lancer ce pipeline, dans l'ordre où la base les vérifie.
export function pipelineRestriction(
  planKey: PlanKey,
  brief: Pick<Brief, "durationMinutes" | "video">,
  tier: ModelTier,
  { pastDue = false }: { pastDue?: boolean } = {},
): PlanRestriction | null {
  const plan = PLANS[planKey];
  if (pastDue) return { reason: "subscription_past_due", plan: planKey };
  if (brief.durationMinutes > plan.maxDurationMinutes) return { reason: "duration", plan: planKey, limit: plan.maxDurationMinutes };
  if (tier === "premium" && !plan.premium) return { reason: "premium", plan: planKey };
  if (brief.video && !plan.video) return { reason: "video", plan: planKey };
  return null;
}
