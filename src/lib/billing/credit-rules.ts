import type { AssetType, Brief } from "@/lib/ai/schemas";
import type { ModelTier } from "@/lib/pipeline/registry";

// Grille des crédits par asset (ARCHITECTURE §5.1). Module pur, sans le registre ni les prompts :
// l'interface l'importe pour afficher le coût avant chaque action, le registre pour facturer.
export type CostedBrief = Pick<Brief, "durationMinutes" | "thumbnailImages">;

export const CREDIT_RULES: Record<AssetType, (brief: CostedBrief, tier: ModelTier) => number> = {
  script: (brief, tier) => (tier === "premium" ? 8 + 2 * brief.durationMinutes : 4 + brief.durationMinutes),
  titles: () => 1,
  seo: () => 2,
  voiceover: (brief) => 2 + Math.floor(brief.durationMinutes / 10),
  // Plans payants : 4 images générées en haute qualité (≈ 0,19 $ chacune) en plus des concepts.
  thumbnails: (brief) => (brief.thumbnailImages ? 15 : 1),
};

// Vidéo MP4 complète, quand le brief la demande : ≈ 1 $ par minute (4 images haute qualité, voix
// ElevenLabs, rendu Shotstack), facturé avec une marge d'environ ×3 au prix du crédit Creator.
// Provisoire : à recalibrer d'après les coûts mesurés (/admin).
export const VIDEO_CREDITS_PER_MINUTE = 60;
export const videoCredits = (brief: Pick<Brief, "durationMinutes" | "video">) => (brief.video ? VIDEO_CREDITS_PER_MINUTE * brief.durationMinutes : 0);
