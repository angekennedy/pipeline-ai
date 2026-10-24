import { ScriptSchema } from "./script";
import { SeoSchema } from "./seo";
import { ThumbnailsSchema } from "./thumbnails";
import { TitlesSchema } from "./titles";
import { VoiceoverSchema } from "./voiceover";

// Ordre du DAG : le script d'abord, puis les assets qui en dérivent.
export const ASSET_TYPES = ["script", "titles", "seo", "voiceover", "thumbnails"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const assetSchemas = {
  script: ScriptSchema,
  titles: TitlesSchema,
  seo: SeoSchema,
  voiceover: VoiceoverSchema,
  thumbnails: ThumbnailsSchema,
} as const satisfies Record<AssetType, unknown>;

export * from "./brief";
export * from "./script";
export * from "./seo";
export * from "./thumbnails";
export * from "./titles";
export * from "./voiceover";
