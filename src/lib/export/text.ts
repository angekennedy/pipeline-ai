import type { Script, Seo, Thumbnails, Titles, Voiceover } from "@/lib/ai/schemas";
import type { Translator } from "@/i18n/types";
import { formatTimestamp } from "@/lib/pipeline/postprocess/chapters";

// Texte brut prêt à coller (YouTube Studio, outil de voix, générateur d'images). Aucun HTML :
// le contenu vient du modèle et n'est jamais interprété. Les intitulés suivent la langue de
// l'interface (`t`) ; le contenu reste dans la langue de la vidéo.

const lines = (...parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join("\n");
const blocks = (...parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join("\n\n");

export function scriptToText(script: Script, t: Translator): string {
  let start = 0;
  const scenes = script.scenes.map((scene) => {
    const header = `[${formatTimestamp(start)} · ${t(`Labels.scenePurpose.${scene.purpose}`)}] ${scene.index}. ${scene.title}`;
    start += scene.estimatedSeconds;
    return lines(
      header,
      t("Export.narration", { text: scene.narration }),
      t("Export.visual", { text: scene.visualDirection }),
      scene.onScreenText && t("Export.onScreen", { text: scene.onScreenText }),
      scene.bRollKeywords.length > 0 && t("Export.bRoll", { text: scene.bRollKeywords.join(", ") }),
    );
  });
  const flags =
    script.factCheckFlags.length > 0 &&
    lines(t("Export.factChecks"), ...script.factCheckFlags.map((flag) => t("Export.factCheck", { scene: flag.sceneIndex, claim: flag.claim })));

  return blocks(lines(script.workingTitle, script.hookSummary), ...scenes, t("Export.callToAction", { text: script.callToAction }), flags);
}

export const narrationToText = (script: Script) => blocks(...script.scenes.map((scene) => scene.narration));

export const titlesToText = (titles: Titles, t: Translator) =>
  titles.variants
    .map((variant, i) => `${i + 1}. ${variant.title}${i === titles.recommendedIndex ? ` ${t("Export.recommended")}` : ""}`)
    .join("\n");

// Description complète pour YouTube : les chapitres horodatés suivent la description, les hashtags
// viennent en dernier (YouTube affiche les trois premiers au-dessus du titre).
export const seoToText = (seo: Seo) =>
  blocks(
    seo.description,
    seo.chapters && seo.chapters.length > 0 && seo.chapters.map((chapter) => `${chapter.timestamp} ${chapter.title}`).join("\n"),
    seo.hashtags.length > 0 && seo.hashtags.join(" "),
  );

export const tagsToText = (seo: Seo) => seo.tags.join(", ");

export function voiceoverToText(voiceover: Voiceover, t: Translator): string {
  const { gender, age, accent, baseStyle } = voiceover.globalVoice;
  const segments = voiceover.segments.map((segment) =>
    lines(
      t("Export.segment", { scene: segment.sceneIndex, pace: t(`Labels.pace.${segment.pace}`), emotion: segment.emotion }),
      segment.text,
      segment.emphasisWords.length > 0 && t("Export.emphasis", { text: segment.emphasisWords.join(", ") }),
      segment.pronunciationHints.length > 0 &&
        t("Export.pronunciation", { text: segment.pronunciationHints.map((hint) => `${hint.word} → ${hint.phonetic}`).join(", ") }),
      t("Export.pauseAfter", { ms: segment.pauseAfterMs }),
      t("Export.directions", { text: segment.providerPrompt }),
    ),
  );
  return blocks(t("Export.voice", { gender, age, accent, style: baseStyle }), ...segments);
}

export function thumbnailsToText(thumbnails: Thumbnails, titles: Titles | null, t: Translator): string {
  return blocks(
    ...thumbnails.concepts.map((concept, i) => {
      const title = titles?.variants[concept.pairedTitleIndex]?.title;
      const { text, placement, colorHex, strokeHex, fontStyle } = concept.textOverlay;
      return lines(
        title ? t("Export.conceptFor", { index: i + 1, title }) : t("Export.concept", { index: i + 1 }),
        t("Export.prompt", { text: concept.imagePrompt }),
        t("Export.negativePrompt", { text: concept.negativePrompt }),
        t("Export.composition", { text: concept.composition }),
        t("Export.emotion", { text: concept.focalEmotion }),
        t("Export.overlay", { text, placement, color: colorHex, stroke: strokeHex, font: fontStyle }),
        t("Export.format", { text: concept.aspectRatio }),
      );
    }),
  );
}
