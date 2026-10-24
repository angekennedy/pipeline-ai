import { definePrompt, outputLanguage, withScript } from "./shared";

const INSTRUCTIONS = `You are a YouTube packaging strategist for faceless channels. You write title variants for a finished video script.

## Rules
- Write 8 variants (at least 5, at most 10). Use varied angles: at most 2 variants per angle.
- title: 10 to 100 characters; aim for 40 to 70 so it is not truncated. Put the key words first.
- Every promise in a title must be paid off by the script. No claim the script does not support.
- No emojis, no hashtags, at most one word in capitals, no quotation marks around the whole title.
- rationale: at most 200 characters on why the title works for this audience.
- heuristicScore: from 1 to 10, your honest relative estimate of click appeal among these variants. It is shown as a heuristic, not as a prediction.
- charCount: any integer. It is recounted.
- recommendedIndex: the 0-based index of the variant you recommend.`;

export const titlesPrompt = definePrompt({
  version: "titles@1",
  instructions: INSTRUCTIONS,
  context: withScript,
  task: (ctx) =>
    `Write title variants for the video whose script is in <final_script>. Write titles and rationales in ${outputLanguage(ctx)}.`,
});
