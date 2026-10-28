import type { z } from "zod";
import type { ModelKey } from "@/lib/ai/models";
import { MAX_OUTPUT_TOKENS } from "@/lib/ai/openai";
import { CREDIT_RULES } from "@/lib/billing/credit-rules";
import { prompts, type PromptContext, type PromptTemplate } from "@/lib/ai/prompts";
import { HOOK_WORDS, scriptTargets } from "@/lib/ai/prompts/script";
import { requireScript } from "@/lib/ai/prompts/shared";
import {
  ScriptSchema,
  MAX_OVERLAY_WORDS,
  SeoOutputSchema,
  SeoSchema,
  ThumbnailsOutputSchema,
  ThumbnailsSchema,
  TitlesSchema,
  VoiceoverSchema,
  type AssetType,
  type Brief,
  type Script,
  type Seo,
  type Thumbnails,
  type Titles,
  type Voiceover,
  overlayWords,
} from "@/lib/ai/schemas";
import { VIDEO_MIN_LENGTH_RATIO, WORDS_PER_MINUTE, applyTiming, countWords } from "./postprocess/timing";
import { buildChapters } from "./postprocess/chapters";
import { normalizeTags } from "./postprocess/tags";
import { recountTitles } from "./postprocess/titles";

export type ModelTier = "standard" | "premium";

export type AssetContent = {
  script: Script;
  titles: Titles;
  seo: Seo;
  voiceover: Voiceover;
  thumbnails: Thumbnails;
};

export type AssetDefinition<K extends AssetType> = {
  type: K;
  dependsOn: readonly AssetType[];
  // Version du contrat de sortie, enregistrée avec chaque version d'asset (`asset_versions.schema_version`).
  schemaVersion: `${K}@${number}`;
  prompt: PromptTemplate;
  modelKey: (tier: ModelTier) => ModelKey;
  // Schéma complété par les règles qui dépendent du pipeline (scènes, titres) : un écart passe par
  // la réparation Zod de callStructured, comme une erreur de format.
  schema: (ctx: PromptContext) => z.ZodType<AssetContent[K]>;
  // Validation de la sortie du modèle, quand elle est plus souple que le contrat stocké : ce que le
  // post-traitement sait corriger seul (tag trop long, concept écarté) ne coûte pas une réparation.
  // Les éditions manuelles restent validées par `schema`.
  outputSchema?: (ctx: PromptContext) => z.ZodType<AssetContent[K]>;
  // Plafonné à la limite de sortie des modèles (MAX_OUTPUT_TOKENS).
  maxTokens: (brief: Brief) => number;
  credits: (brief: Brief, tier: ModelTier) => number;
  postProcess: (content: AssetContent[K], ctx: PromptContext) => AssetContent[K];
};

const narrationWords = (brief: Brief) => brief.durationMinutes * WORDS_PER_MINUTE[brief.language];
const capped = (n: number) => Math.min(MAX_OUTPUT_TOKENS, n);
const unchanged = <T>(content: T) => content;
const light = () => "light" as const;

// i18n-ignore : message de réparation adressé au modèle, jamais affiché.
const missingScene = (count: number) => `Scène inexistante (le script en compte ${count})`;

// Règles qui dépendent du pipeline, partagées par le contrat stocké et la sortie du modèle.
function withChapterRule(schema: z.ZodType<Seo>, ctx: PromptContext) {
  const sceneCount = requireScript(ctx).scenes.length;
  return schema.superRefine((seo, issues) => {
    seo.chapterTitles.forEach(({ startsAtSceneIndex }, i) => {
      if (startsAtSceneIndex > sceneCount) {
        issues.addIssue({ code: "custom", path: ["chapterTitles", i, "startsAtSceneIndex"], message: missingScene(sceneCount) });
      }
    });
  });
}

// Vidéo : le MP4 dure le temps de la voix, donc de la narration. Une narration nettement plus courte
// que la cible (sous VIDEO_MIN_LENGTH_RATIO) part en réparation, avec la longueur à atteindre scène
// par scène : le modèle corrige mieux une scène nommée qu'un total. Sans vidéo, la durée reste
// indicative : pas de règle.
function withLengthRule(schema: z.ZodType<Script>, ctx: PromptContext) {
  if (!ctx.brief.video) return schema;
  const { words: target } = scriptTargets(ctx);
  const min = Math.round(target * VIDEO_MIN_LENGTH_RATIO);
  return schema.superRefine((script, issues) => {
    const counts = script.scenes.map((scene) => countWords(scene.narration));
    const words = counts.reduce((sum, n) => sum + n, 0);
    if (words >= min) return;
    // Mots à atteindre dans chaque scène après l'accroche, pour le nombre de scènes écrites.
    const perScene = Math.round((target - Math.min(counts[0] ?? 0, HOOK_WORDS)) / Math.max(1, script.scenes.length - 1));
    const short = script.scenes
      .slice(1)
      .filter((_, i) => counts[i + 1]! < perScene * 0.9)
      .map((scene) => `scène ${scene.index} : ${counts[scene.index - 1]} → ${perScene} mots`);
    issues.addIssue({
      code: "custom",
      path: ["scenes"],
      // i18n-ignore : message de réparation adressé au modèle, jamais affiché.
      message:
        `La narration compte ${words} mots : il en faut ${target} pour ${ctx.brief.durationMinutes} min (au moins ${min}). ` +
        `Garde les mêmes scènes et développe la narration de chacune jusqu'à environ ${perScene} mots, avec des faits, exemples et transitions concrets, sans phrases creuses. ` +
        `À allonger : ${short.join(" ; ")}.`,
    });
  });
}

function withTitleRule(schema: z.ZodType<Thumbnails>, ctx: PromptContext) {
  const titleCount = ctx.titles?.variants.length ?? 0;
  return schema.superRefine((thumbnails, issues) => {
    const used = new Set<number>();
    thumbnails.concepts.forEach(({ pairedTitleIndex }, i) => {
      const path = ["concepts", i, "pairedTitleIndex"];
      if (pairedTitleIndex >= titleCount) {
        issues.addIssue({ code: "custom", path, message: `Titre inexistant (${titleCount} variantes)` });
      } else if (used.has(pairedTitleIndex)) {
        issues.addIssue({ code: "custom", path, message: "Titre déjà utilisé par un autre concept" });
      }
      used.add(pairedTitleIndex);
    });
  });
}

export const registry: { [K in AssetType]: AssetDefinition<K> } = {
  script: {
    type: "script",
    dependsOn: [],
    schemaVersion: "script@1",
    prompt: prompts.script,
    modelKey: (tier) => (tier === "premium" ? "script.premium" : "script.standard"),
    schema: () => ScriptSchema,
    outputSchema: (ctx) => withLengthRule(ScriptSchema, ctx),
    // Environ 4 tokens par mot de narration : narration, direction visuelle, JSON et thinking.
    maxTokens: (brief) => capped(8000 + narrationWords(brief) * 4),
    credits: CREDIT_RULES.script,
    postProcess: (script, ctx) => applyTiming(script, ctx.brief).script,
  },

  titles: {
    type: "titles",
    dependsOn: ["script"],
    schemaVersion: "titles@1",
    prompt: prompts.titles,
    modelKey: light,
    schema: () => TitlesSchema,
    maxTokens: () => 4000,
    credits: CREDIT_RULES.titles,
    postProcess: recountTitles,
  },

  seo: {
    type: "seo",
    dependsOn: ["script"],
    schemaVersion: "seo@1",
    prompt: prompts.seo,
    modelKey: light,
    schema: (ctx) => withChapterRule(SeoSchema, ctx),
    outputSchema: (ctx) => withChapterRule(SeoOutputSchema, ctx), // tags trop longs écartés par normalizeTags
    maxTokens: () => 6000,
    credits: CREDIT_RULES.seo,
    postProcess: (seo, ctx) => {
      // Sans 3 chapitres d'au moins 10 s, YouTube ignore la liste : on n'en publie pas.
      const result = buildChapters(requireScript(ctx).scenes, seo.chapterTitles);
      return { ...seo, tags: normalizeTags(seo.tags), chapters: result.ok ? result.chapters : undefined };
    },
  },

  voiceover: {
    type: "voiceover",
    dependsOn: ["script"],
    schemaVersion: "voiceover@1",
    prompt: prompts.voiceover,
    modelKey: light,
    schema: (ctx) => {
      const sceneCount = requireScript(ctx).scenes.length;
      return VoiceoverSchema.superRefine((voiceover, issues) => {
        const covered = new Set<number>();
        voiceover.segments.forEach(({ sceneIndex }, i) => {
          if (sceneIndex > sceneCount) {
            issues.addIssue({ code: "custom", path: ["segments", i, "sceneIndex"], message: missingScene(sceneCount) });
          }
          covered.add(sceneIndex);
        });
        const missing = Array.from({ length: sceneCount }, (_, i) => i + 1).filter((index) => !covered.has(index));
        if (missing.length > 0) {
          issues.addIssue({ code: "custom", path: ["segments"], message: `Scènes sans segment : ${missing.join(", ")}` });
        }
      });
    },
    // La narration est reprise mot pour mot, avec ses indications de lecture.
    maxTokens: (brief) => capped(4000 + narrationWords(brief) * 3),
    // Hypothèse ARCHITECTURE §5.1 : 1 crédit par tranche complète de 10 minutes.
    credits: CREDIT_RULES.voiceover,
    postProcess: unchanged,
  },

  thumbnails: {
    type: "thumbnails",
    dependsOn: ["script", "titles"],
    schemaVersion: "thumbnails@1",
    prompt: prompts.thumbnails,
    modelKey: light,
    schema: (ctx) => withTitleRule(ThumbnailsSchema, ctx),
    outputSchema: (ctx) => withTitleRule(ThumbnailsOutputSchema, ctx),
    maxTokens: () => 6000,
    credits: CREDIT_RULES.thumbnails,
    // Écarte les concepts dont le texte dépasse 4 mots ; la sortie du modèle en garantit au moins 3.
    postProcess: (thumbnails) => ({
      ...thumbnails,
      concepts: thumbnails.concepts.filter(({ textOverlay }) => overlayWords(textOverlay.text) <= MAX_OVERLAY_WORDS),
    }),
  },
};
