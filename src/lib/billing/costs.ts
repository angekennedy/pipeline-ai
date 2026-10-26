import { ASSET_TYPES, type AssetType, type Brief } from "@/lib/ai/schemas";
import type { ModelTier } from "@/lib/pipeline/registry";
import { CREDIT_RULES } from "./credit-rules";

// Coût en crédits, par asset et pour tout le pipeline (ARCHITECTURE §5.1). Une seule source :
// CREDIT_RULES, que le registre utilise aussi pour les `credits` enregistrés sur chaque génération.
// Sans dépendance serveur : le formulaire de brief affiche ce coût avant le lancement.

type CostedBrief = Pick<Brief, "durationMinutes">;

export function assetCredits(brief: CostedBrief, tier: ModelTier): Record<AssetType, number> {
  return Object.fromEntries(ASSET_TYPES.map((type) => [type, CREDIT_RULES[type](brief, tier)])) as Record<AssetType, number>;
}

// Montant réservé à la création du pipeline.
export function pipelineCredits(brief: CostedBrief, tier: ModelTier): number {
  return Object.values(assetCredits(brief, tier)).reduce((total, credits) => total + credits, 0);
}
