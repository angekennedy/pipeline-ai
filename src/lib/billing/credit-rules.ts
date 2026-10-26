import type { AssetType, Brief } from "@/lib/ai/schemas";
import type { ModelTier } from "@/lib/pipeline/registry";

// Grille des crédits par asset (ARCHITECTURE §5.1). Module pur, sans le registre ni les prompts :
// l'interface l'importe pour afficher le coût avant chaque action, le registre pour facturer.
export const CREDIT_RULES: Record<AssetType, (brief: Pick<Brief, "durationMinutes">, tier: ModelTier) => number> = {
  script: (brief, tier) => (tier === "premium" ? 8 + 2 * brief.durationMinutes : 4 + brief.durationMinutes),
  titles: () => 1,
  seo: () => 2,
  voiceover: (brief) => 2 + Math.floor(brief.durationMinutes / 10),
  thumbnails: () => 1,
};
