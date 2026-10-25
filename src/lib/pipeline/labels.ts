import type { AssetType, Scene, VoiceoverSegment } from "@/lib/ai/schemas";
import type { PipelineStatus } from "./status";

// Libellés affichés à l'utilisateur, partagés par l'interface et les exports texte.

export const ASSET_LABELS: Record<AssetType, string> = {
  script: "Script",
  titles: "Titres",
  seo: "SEO",
  voiceover: "Voix off",
  thumbnails: "Miniatures",
};

export const SCENE_PURPOSE_LABELS: Record<Scene["purpose"], string> = {
  hook: "Accroche",
  context: "Contexte",
  development: "Développement",
  twist: "Rebondissement",
  payoff: "Révélation",
  cta: "Appel à l'action",
};

export const PACE_LABELS: Record<VoiceoverSegment["pace"], string> = {
  slow: "lent",
  medium: "moyen",
  fast: "rapide",
};

export const PIPELINE_STATUS_LABELS: Record<PipelineStatus, string> = {
  queued: "En file d'attente",
  running: "En cours",
  completed: "Terminé",
  partial: "Partiel",
  failed: "Échec",
  canceled: "Annulé",
};
