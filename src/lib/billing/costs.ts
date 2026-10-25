import { ASSET_TYPES, type AssetType, type Brief } from "@/lib/ai/schemas";
import { registry, type ModelTier } from "@/lib/pipeline/registry";

// Coût en crédits, par asset et pour tout le pipeline (ARCHITECTURE §5.1). Une seule source : les
// fonctions `credits` du registre, que generateAsset enregistre aussi sur chaque génération.

export function assetCredits(brief: Brief, tier: ModelTier): Record<AssetType, number> {
  return Object.fromEntries(ASSET_TYPES.map((type) => [type, registry[type].credits(brief, tier)])) as Record<AssetType, number>;
}

// Montant réservé à la création du pipeline.
export function pipelineCredits(brief: Brief, tier: ModelTier): number {
  return Object.values(assetCredits(brief, tier)).reduce((total, credits) => total + credits, 0);
}
