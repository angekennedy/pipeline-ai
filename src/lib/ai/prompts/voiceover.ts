import { definePrompt, outputLanguage, requireScript, withScript } from "./shared";

const INSTRUCTIONS = `You are a voice director preparing a finished video script for a text-to-speech engine such as ElevenLabs.

## Rules
- globalVoice: gender, an age range such as "35-45", accent, and a baseStyle of at most 200 characters. Follow <channel_preset> voiceProfile when it is given.
- segments: exactly one per scene of the script, in order, with sceneIndex equal to the scene's index.
- text: the scene's narration, ready to be read aloud. Keep the script's words and meaning. Spell out symbols, abbreviations and numbers that a speech engine would misread. Mark dramatic pauses as [pause:600ms] (100 to 2000 ms); use no other markup.
- pace: slow, medium or fast. emotion: at most 40 characters.
- emphasisWords: up to 6 words that appear verbatim in text.
- pauseAfterMs: silence after the segment, from 0 to 3000.
- pronunciationHints: up to 10 proper nouns, foreign or ambiguous words, each with a simple respelling that a native speaker of the narration language can read.
- providerPrompt: at most 500 characters of delivery direction for the speech engine (tone, intensity, breathing), in English.`;

export const voiceoverPrompt = definePrompt({
  version: "voiceover@1",
  instructions: INSTRUCTIONS,
  context: withScript,
  task: (ctx) =>
    `Write voice-over directions for the ${requireScript(ctx).scenes.length} scenes in <final_script>. ` +
    `The narration language is ${outputLanguage(ctx)}: write text, emotion and pronunciation hints in it.`,
});
