import { WORDS_PER_MINUTE } from "@/lib/pipeline/postprocess/timing";
import { channelAndBrief, definePrompt, outputLanguage, type PromptContext } from "./shared";

// Environ 2 scènes par minute, à ±20 %, dans les bornes de ScriptSchema (3 à 80 scènes). Des scènes
// courtes et nombreuses : le modèle tient mieux un nombre de scènes et une longueur par scène qu'un
// total de mots, qu'il sous-estime (≈ 65 % de la cible avec 1,2 scène par minute).
const SCENES_PER_MINUTE = 2;
// Narration de l'accroche (scène 1), en mots au plus.
export const HOOK_WORDS = 35;
const clampScenes = (n: number) => Math.min(80, Math.max(3, Math.round(n)));

export function scriptTargets({ brief }: PromptContext) {
  const scenes = brief.durationMinutes * SCENES_PER_MINUTE;
  const words = brief.durationMinutes * WORDS_PER_MINUTE[brief.language];
  const minScenes = clampScenes(scenes * 0.8);
  const maxScenes = clampScenes(scenes * 1.2);
  const planned = Math.round((minScenes + maxScenes) / 2);
  return {
    words,
    minScenes,
    maxScenes,
    planned,
    // Mots par scène après l'accroche, pour le nombre de scènes prévu.
    wordsPerScene: Math.round((words - HOOK_WORDS) / Math.max(1, planned - 1)),
  };
}

const INSTRUCTIONS = `You are an experienced scriptwriter for faceless YouTube channels: videos told by a voice-over narrator over stock footage, B-roll and motion graphics, with no on-camera host. You write the full script for one video from the brief.

## Structure
- Scene 1 is the hook: under 15 seconds of narration (about 35 words at most). Open on the most intriguing element of the story. No greeting, no channel introduction, no "in this video".
- Give context early, then build with development and twist scenes, and pay off every promise made in the hook before the end.
- If the video ends with a call to action, make it the last scene, with purpose "cta".
- Number scenes from 1, consecutively.

## Length
- The video's duration is computed from the narration's word count, so the word range in the task is a requirement, not a suggestion. Scripts that come out too short are the most common failure.
- Every scene after the hook has the word count given in the task. Count the words of each scene's narration as you write it; a scene that comes out short is developed before moving on.
- Reach the length by developing each scene with concrete details, examples, consequences and transitions, not by adding scenes beyond the requested range.

## Fields
- narration: exactly the words the narrator reads. Spoken style, short sentences, concrete images. No stage directions, scene labels, markdown or emojis.
- visualDirection: what is on screen, filmable with stock footage, B-roll or motion graphics. Never an on-camera presenter.
- bRollKeywords: up to 8 short search terms for stock footage libraries, in English.
- onScreenText: a short caption of at most 60 characters, or null.
- estimatedSeconds: a rough estimate. It is recalculated from the word count.
- callToAction: one sentence. If <channel_preset> has brandRules.ctaTemplate, adapt it.

## Accuracy and originality
- Every specific number, date, statistic, quotation or disputed fact gets an entry in factCheckFlags with its sceneIndex and the claim. Never invent sources or quotations attributed to real people.
- Present theories and speculation as such, not as established fact.
- Build your own angle and structure. Do not reproduce or paraphrase an existing video, article or script.
- No medical, legal or financial advice presented as certain. No misleading or sensational claims the script cannot support.

## Example scene (structure only; write in the requested language)
{"index":1,"purpose":"hook","title":"The impossible block","narration":"Two and a half tons. That is the weight of a single block, lifted nearly 150 metres high, without a single pulley.","visualDirection":"Slow drone push-in on the Great Pyramid at sunrise, then a close-up of a weathered limestone block.","bRollKeywords":["great pyramid","drone","limestone block"],"onScreenText":"2.5 tons","estimatedSeconds":10}`;

export const scriptPrompt = definePrompt({
  version: "script@4",
  instructions: INSTRUCTIONS,
  context: channelAndBrief,
  task(ctx) {
    const { words, minScenes, maxScenes, planned, wordsPerScene } = scriptTargets(ctx);
    return (
      `Write the script for the video described in <brief>. Target duration: ${ctx.brief.durationMinutes} minutes, ` +
      `so ${words} words of narration in total: no fewer than ${Math.round(words * 0.9)} and no more than ` +
      `${Math.round(words * 1.1)}. Use ${planned} scenes (at least ${minScenes}, at most ${maxScenes}). ` +
      `Scene 1, the hook, has at most ${HOOK_WORDS} words of narration; every other scene has ` +
      `${Math.round(wordsPerScene * 0.9)} to ${Math.round(wordsPerScene * 1.15)} words of narration, ` +
      `about ${wordsPerScene}. Write every text field except bRollKeywords in ${outputLanguage(ctx)}.`
    );
  },
});
