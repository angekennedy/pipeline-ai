import type { AssetType } from "@/lib/ai/schemas";
import { scriptPrompt } from "./script";
import { seoPrompt } from "./seo";
import type { PromptTemplate } from "./shared";
import { thumbnailsPrompt } from "./thumbnails";
import { titlesPrompt } from "./titles";
import { voiceoverPrompt } from "./voiceover";

export const prompts: Record<AssetType, PromptTemplate> = {
  script: scriptPrompt,
  titles: titlesPrompt,
  seo: seoPrompt,
  voiceover: voiceoverPrompt,
  thumbnails: thumbnailsPrompt,
};

export type { BuiltPrompt, PromptContext, PromptTemplate } from "./shared";
