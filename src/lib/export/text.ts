import type { Script, Seo, Thumbnails, Titles, Voiceover } from "@/lib/ai/schemas";
import { PACE_LABELS, SCENE_PURPOSE_LABELS } from "@/lib/pipeline/labels";
import { formatTimestamp } from "@/lib/pipeline/postprocess/chapters";

// Texte brut prêt à coller (YouTube Studio, outil de voix, générateur d'images). Aucun HTML :
// le contenu vient du modèle et n'est jamais interprété.

const lines = (...parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join("\n");
const blocks = (...parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join("\n\n");

export function scriptToText(script: Script): string {
  let start = 0;
  const scenes = script.scenes.map((scene) => {
    const header = `[${formatTimestamp(start)} · ${SCENE_PURPOSE_LABELS[scene.purpose]}] ${scene.index}. ${scene.title}`;
    start += scene.estimatedSeconds;
    return lines(
      header,
      `Narration : ${scene.narration}`,
      `Visuel : ${scene.visualDirection}`,
      scene.onScreenText && `Texte à l'écran : ${scene.onScreenText}`,
      scene.bRollKeywords.length > 0 && `B-roll : ${scene.bRollKeywords.join(", ")}`,
    );
  });
  const flags =
    script.factCheckFlags.length > 0 &&
    lines("Points à vérifier :", ...script.factCheckFlags.map((flag) => `- Scène ${flag.sceneIndex} : ${flag.claim}`));

  return blocks(lines(script.workingTitle, script.hookSummary), ...scenes, `Appel à l'action : ${script.callToAction}`, flags);
}

export const narrationToText = (script: Script) => blocks(...script.scenes.map((scene) => scene.narration));

export const titlesToText = (titles: Titles) =>
  titles.variants
    .map((variant, i) => `${i + 1}. ${variant.title}${i === titles.recommendedIndex ? " (recommandé)" : ""}`)
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

export function voiceoverToText(voiceover: Voiceover): string {
  const { gender, age, accent, baseStyle } = voiceover.globalVoice;
  const segments = voiceover.segments.map((segment) =>
    lines(
      `Scène ${segment.sceneIndex} · rythme ${PACE_LABELS[segment.pace]} · ${segment.emotion}`,
      segment.text,
      segment.emphasisWords.length > 0 && `Mots appuyés : ${segment.emphasisWords.join(", ")}`,
      segment.pronunciationHints.length > 0 &&
        `Prononciation : ${segment.pronunciationHints.map((hint) => `${hint.word} → ${hint.phonetic}`).join(", ")}`,
      `Pause après : ${segment.pauseAfterMs} ms`,
      `Indications : ${segment.providerPrompt}`,
    ),
  );
  return blocks(`Voix : ${gender}, ${age}, ${accent}. ${baseStyle}`, ...segments);
}

export function thumbnailsToText(thumbnails: Thumbnails, titles: Titles | null): string {
  return blocks(
    ...thumbnails.concepts.map((concept, i) => {
      const title = titles?.variants[concept.pairedTitleIndex]?.title;
      const { text, placement, colorHex, strokeHex, fontStyle } = concept.textOverlay;
      return lines(
        `Concept ${i + 1}${title ? ` · pour « ${title} »` : ""}`,
        `Prompt : ${concept.imagePrompt}`,
        `Prompt négatif : ${concept.negativePrompt}`,
        `Composition : ${concept.composition}`,
        `Émotion : ${concept.focalEmotion}`,
        `Texte : ${text} (${placement}, ${colorHex} sur contour ${strokeHex}, ${fontStyle})`,
        `Format : ${concept.aspectRatio}`,
      );
    }),
  );
}
