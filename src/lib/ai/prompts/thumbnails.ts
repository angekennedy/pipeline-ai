import type { Titles } from "@/lib/ai/schemas";
import { renderUntrusted } from "@/lib/security/untrusted";
import { definePrompt, outputLanguage, withScript, type PromptContext } from "./shared";

const INSTRUCTIONS = `You are a YouTube thumbnail art director. You design thumbnail concepts for a finished video, each paired with one of its titles.

## Rules
- Write 3 or 4 concepts, each paired with a different title: pairedTitleIndex is the title's index in <titles>. The thumbnail completes its title and never repeats it.
- imagePrompt: at most 1200 characters, in English, for a text-to-image model. Describe the subject, setting, lighting, camera angle and lens, style and mood. One clear focal point that stays readable at small size, and empty space where the text overlay goes. No text in the image: the overlay is added separately.
- negativePrompt: at most 400 characters, in English (for example text, watermark, logo, blur, extra fingers).
- composition: at most 300 characters. focalEmotion: at most 40 characters.
- textOverlay.text: at most 4 words and 30 characters, never the title itself. Place it in the empty area. colorHex and strokeHex are #RRGGBB colours with strong contrast; use <channel_preset> brandRules.thumbnailPalette when it is given.
- aspectRatio: always "16:9".
- No likeness of real people, no trademarks or logos, and no imagery that misrepresents the video.`;

function requireTitles(ctx: PromptContext): Titles {
  if (!ctx.titles) throw new Error("Le contexte doit contenir les titres");
  return ctx.titles;
}

export const thumbnailsPrompt = definePrompt({
  version: "thumbnails@1",
  instructions: INSTRUCTIONS,
  context: (ctx) => [
    ...withScript(ctx),
    renderUntrusted(
      "titles",
      requireTitles(ctx).variants.map(({ title, angle }, index) => ({ index, title, angle })),
    ),
  ],
  task: (ctx) =>
    `Write thumbnail concepts for the video in <final_script>, paired with the titles in <titles> ` +
    `(indexes 0 to ${requireTitles(ctx).variants.length - 1}). Write textOverlay.text in ${outputLanguage(ctx)}, ` +
    `and imagePrompt and negativePrompt in English.`,
});
