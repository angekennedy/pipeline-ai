import "server-only";
import type { PromptContext } from "@/lib/ai/prompts";
import type { AssetType, Brief, Script, Seo, Thumbnails, Titles, Voiceover } from "@/lib/ai/schemas";
import { registry } from "@/lib/pipeline/registry";
import { regenerationCredits } from "@/lib/pipeline/staleness";
import { emptyPipelineView, type AssetView, type PipelineView, type VersionSummary } from "@/lib/pipeline/view";
import { EXAMPLE_IDS, example, type ExampleMeta } from "./examples";

// Pipelines de démonstration, en attendant la base (tâche 0.4) : un par état à montrer.
// Le contenu passe par les vrais post-traitements (durées, chapitres, tags), comme une génération.

// Plus les pipelines d'exemple réels (./examples.ts, tâche 5.1).
export const DEMO_PIPELINE_IDS = ["demo-running", "demo-completed", "demo-partial", "demo-failed", "demo-stale", ...EXAMPLE_IDS] as const;
export type DemoPipelineId = (typeof DEMO_PIPELINE_IDS)[number];

const brief: Brief = {
  niche: "Histoire",
  topic: "Comment les pyramides de Gizeh ont-elles été construites ?",
  language: "fr",
  tone: "mysterious",
  durationMinutes: 3,
  style: "documentary",
  targetAudience: "Curieux d'histoire, 25-45 ans",
};

const rawScript: Script = {
  workingTitle: "Le chantier impossible de Gizeh",
  hookSummary: "Des blocs de plusieurs tonnes, sans poulie ni roue : comment les Égyptiens ont-ils fait ?",
  scenes: [
    {
      index: 1,
      purpose: "hook",
      title: "Le bloc impossible",
      narration: "Deux tonnes et demie. C'est le poids moyen d'un seul bloc de la grande pyramide. Il y en a plus de deux millions. Et personne, à ce jour, ne sait exactement comment ils ont été hissés.",
      visualDirection: "Lent travelling drone vers la grande pyramide au lever du soleil, puis gros plan sur un bloc de calcaire érodé.",
      bRollKeywords: ["great pyramid", "drone sunrise", "limestone block"],
      onScreenText: "2,5 tonnes",
      estimatedSeconds: 10,
    },
    {
      index: 2,
      purpose: "context",
      title: "Gizeh, vers 2560 av. J.-C.",
      narration: "Nous sommes sous le règne de Khéops, il y a environ quatre mille cinq cents ans. Le pharaon veut un tombeau à la mesure de son pouvoir. Le chantier va durer une vingtaine d'années et mobiliser des milliers d'ouvriers, logés dans une véritable ville au pied du plateau.",
      visualDirection: "Carte animée du Nil, zoom sur le plateau de Gizeh, puis reconstitution 3D du village d'ouvriers.",
      bRollKeywords: ["nile map", "giza plateau", "ancient village"],
      onScreenText: "Règne de Khéops",
      estimatedSeconds: 20,
    },
    {
      index: 3,
      purpose: "development",
      title: "Les carrières",
      narration: "La plupart des blocs viennent de carrières situées à quelques centaines de mètres. Les ouvriers creusent des rainures dans la roche, y enfoncent des coins, puis détachent les blocs. Le granit des chambres intérieures, lui, arrive d'Assouan, à plus de huit cents kilomètres en amont.",
      visualDirection: "Plans de carrières antiques, outils en cuivre en vitrine, animation des rainures et des coins.",
      bRollKeywords: ["ancient quarry", "copper tools", "aswan granite"],
      onScreenText: null,
      estimatedSeconds: 20,
    },
    {
      index: 4,
      purpose: "development",
      title: "Le Nil comme autoroute",
      narration: "Pour transporter ces masses, les Égyptiens utilisent le fleuve. En 2013, des archéologues découvrent à Ouadi el-Jarf des papyrus : le journal de bord d'un inspecteur nommé Merer, qui décrit le transport de calcaire par bateau jusqu'à Gizeh, à travers des canaux creusés pour l'occasion.",
      visualDirection: "Bateaux en bois sur le Nil (reconstitution), gros plan sur des fragments de papyrus.",
      bRollKeywords: ["nile boat", "papyrus fragments", "ancient canal"],
      onScreenText: "Le journal de Merer",
      estimatedSeconds: 20,
    },
    {
      index: 5,
      purpose: "development",
      title: "Le sable mouillé",
      narration: "Restait à tirer les blocs sur la terre ferme. Une peinture d'une tombe de Deir el-Bersha montre une statue colossale tirée sur un traîneau, pendant qu'un homme verse de l'eau devant les patins. Des physiciens ont montré que le sable humide réduit fortement le frottement.",
      visualDirection: "Peinture murale de Djéhoutihotep, puis animation d'un traîneau glissant sur du sable humidifié.",
      bRollKeywords: ["egyptian wall painting", "wooden sledge", "wet sand"],
      onScreenText: null,
      estimatedSeconds: 20,
    },
    {
      index: 6,
      purpose: "twist",
      title: "Le mystère des rampes",
      narration: "Mais comment monter les blocs jusqu'à cent quarante-six mètres de haut ? Une rampe droite aurait dû être plus longue que la pyramide elle-même. Certains chercheurs proposent une rampe enroulée autour de l'édifice, d'autres une rampe intérieure. Aucune théorie ne fait encore l'unanimité.",
      visualDirection: "Modélisation 3D comparant trois hypothèses de rampes : droite, en spirale, intérieure.",
      bRollKeywords: ["pyramid ramp 3d", "spiral ramp", "construction theory"],
      onScreenText: "146 mètres",
      estimatedSeconds: 20,
    },
    {
      index: 7,
      purpose: "payoff",
      title: "Une prouesse d'organisation",
      narration: "Le vrai secret des pyramides n'est peut-être pas une technique perdue, mais une organisation remarquable : des équipes spécialisées, des rations, des registres, une logistique pensée sur des années. Ce sont des hommes, nourris et payés, qui ont bâti ces géants de pierre.",
      visualDirection: "Plans larges du plateau au crépuscule, inscriptions d'équipes d'ouvriers, retour sur la grande pyramide.",
      bRollKeywords: ["giza dusk", "hieroglyph inscription", "pyramid wide shot"],
      onScreenText: null,
      estimatedSeconds: 20,
    },
    {
      index: 8,
      purpose: "cta",
      title: "À vous de juger",
      narration: "Rampe en spirale ou rampe intérieure ? Dites-nous en commentaire quelle théorie vous convainc le plus, et abonnez-vous pour le prochain mystère de l'Égypte ancienne.",
      visualDirection: "Retour au plan d'ouverture, apparition des deux schémas de rampes côte à côte.",
      bRollKeywords: ["pyramid silhouette"],
      onScreenText: "Spirale ou intérieure ?",
      estimatedSeconds: 10,
    },
  ],
  callToAction: "Dites en commentaire quelle théorie vous convainc, et abonnez-vous pour le prochain mystère.",
  factCheckFlags: [
    { sceneIndex: 1, claim: "Poids moyen de 2,5 tonnes et plus de deux millions de blocs" },
    { sceneIndex: 2, claim: "Chantier d'une vingtaine d'années sous Khéops, vers 2560 av. J.-C." },
    { sceneIndex: 4, claim: "Découverte des papyrus de Merer à Ouadi el-Jarf en 2013" },
    { sceneIndex: 6, claim: "Hauteur d'origine de 146 mètres" },
  ],
};

const rawTitles: Titles = {
  variants: [
    { title: "Pyramides : le chantier que personne n'explique", angle: "curiosity_gap", rationale: "Promesse d'un mystère non résolu, cœur de la vidéo", heuristicScore: 8, charCount: 0 },
    { title: "2 millions de blocs, aucune poulie : comment ?", angle: "number", rationale: "Chiffre frappant et question concrète", heuristicScore: 8, charCount: 0 },
    { title: "Le journal de Merer révèle le secret de Gizeh", angle: "story", rationale: "Personnage réel et découverte récente", heuristicScore: 7, charCount: 0 },
    { title: "Comment ont-ils vraiment bâti les pyramides ?", angle: "question", rationale: "Question que se pose le public cible", heuristicScore: 7, charCount: 0 },
    { title: "Ce que les manuels ne disent pas sur Gizeh", angle: "negative", rationale: "Biais de curiosité, à condition de tenir la promesse", heuristicScore: 6, charCount: 0 },
    { title: "La rampe cachée de la grande pyramide", angle: "authority", rationale: "Hypothèse de chercheurs, ton documentaire", heuristicScore: 6, charCount: 0 },
  ],
  recommendedIndex: 1,
};

const rawSeo: Seo = {
  description:
    "Plus de deux millions de blocs, sans poulie ni roue : comment les pyramides de Gizeh ont-elles été construites ? " +
    "Des carrières du plateau au journal de bord de Merer, retrouvé en 2013, on remonte la logistique du plus grand chantier de l'Égypte ancienne.\n\n" +
    "On examine aussi les théories sur les rampes, droite, en spirale ou intérieure, et ce que la science sait vraiment du sable mouillé.\n\n" +
    "Abonnez-vous pour le prochain mystère de l'Égypte ancienne.",
  tags: ["pyramides de gizeh", "construction des pyramides", "Égypte ancienne", "khéops", "journal de merer", "rampe pyramide", "histoire", "documentaire histoire"],
  hashtags: ["#pyramides", "#égypte", "#histoire"],
  chapterTitles: [
    { startsAtSceneIndex: 1, title: "Le bloc impossible" },
    { startsAtSceneIndex: 3, title: "Des carrières au Nil" },
    { startsAtSceneIndex: 5, title: "Tirer les blocs" },
    { startsAtSceneIndex: 6, title: "Le mystère des rampes" },
    { startsAtSceneIndex: 7, title: "Le vrai secret" },
  ],
};

const segment = (sceneIndex: number, overrides: Partial<Voiceover["segments"][number]> = {}): Voiceover["segments"][number] => ({
  sceneIndex,
  text: rawScript.scenes[sceneIndex - 1]!.narration,
  pace: "medium",
  emotion: "curiosité",
  emphasisWords: [],
  pauseAfterMs: 400,
  pronunciationHints: [],
  providerPrompt: "Calm documentary narrator, warm and steady, slight sense of wonder.",
  ...overrides,
});

const rawVoiceover: Voiceover = {
  globalVoice: { gender: "male", age: "40-50", accent: "français standard", baseStyle: "Narrateur documentaire grave et posé, qui laisse respirer les chiffres" },
  segments: [
    segment(1, { text: "Deux tonnes et demie. [pause:600ms] C'est le poids moyen d'un seul bloc de la grande pyramide. Il y en a plus de deux millions. Et personne, à ce jour, ne sait exactement comment ils ont été hissés.", pace: "slow", emotion: "mystère", emphasisWords: ["Deux tonnes et demie", "personne"], pauseAfterMs: 800, providerPrompt: "Low, almost whispered opening, then build intensity on the last sentence." }),
    segment(2, { pronunciationHints: [{ word: "Khéops", phonetic: "ké-ops" }, { word: "Gizeh", phonetic: "gui-zè" }] }),
    segment(3, { pronunciationHints: [{ word: "Assouan", phonetic: "a-sou-an" }] }),
    segment(4, { emotion: "enthousiasme", emphasisWords: ["Merer"], pronunciationHints: [{ word: "Ouadi el-Jarf", phonetic: "oua-di èl-jarf" }, { word: "Merer", phonetic: "mé-rèr" }] }),
    segment(5, { pronunciationHints: [{ word: "Deir el-Bersha", phonetic: "dèr èl-bèr-cha" }] }),
    segment(6, { pace: "slow", emotion: "suspense", emphasisWords: ["cent quarante-six mètres"], pauseAfterMs: 700, providerPrompt: "Slow down, leave space after each theory, end on an open question." }),
    segment(7, { emotion: "admiration", emphasisWords: ["organisation"] }),
    segment(8, { pace: "fast", emotion: "complicité", pauseAfterMs: 0, providerPrompt: "Friendly and direct, a light smile in the voice." }),
  ],
};

const rawThumbnails: Thumbnails = {
  concepts: [
    {
      pairedTitleIndex: 0,
      imagePrompt: "The Great Pyramid of Giza at golden hour seen from a low angle, a single giant limestone block in the foreground casting a long shadow, dust in the air, cinematic documentary photography, 35mm lens, high contrast, empty sky on the upper left",
      negativePrompt: "text, watermark, logo, modern buildings, tourists, blurry, extra limbs",
      composition: "Bloc au premier plan à droite, pyramide en arrière-plan, ciel vide en haut à gauche pour le texte",
      focalEmotion: "intrigue",
      textOverlay: { text: "INEXPLIQUÉ ?", placement: "top-left", colorHex: "#FFD400", strokeHex: "#000000", fontStyle: "bold-sans" },
      aspectRatio: "16:9",
    },
    {
      pairedTitleIndex: 1,
      imagePrompt: "Thousands of ancient Egyptian workers pulling a huge stone on a wooden sledge across wet sand, aerial view, warm dramatic light, epic scale, painterly realism, clear empty area at the bottom",
      negativePrompt: "text, watermark, logo, modern clothing, cartoon, blurry",
      composition: "Vue plongeante, diagonale du traîneau, bas de l'image dégagé",
      focalEmotion: "stupeur",
      textOverlay: { text: "SANS POULIE", placement: "bottom-right", colorHex: "#FFFFFF", strokeHex: "#B91C1C", fontStyle: "condensed" },
      aspectRatio: "16:9",
    },
    {
      pairedTitleIndex: 2,
      imagePrompt: "Close-up of an ancient papyrus fragment with hieratic script lit by a desk lamp, archaeologist gloved hand, the pyramid silhouette reflected in a magnifying glass, shallow depth of field, moody museum lighting",
      negativePrompt: "readable modern text, watermark, logo, blurry, distorted hands",
      composition: "Papyrus au centre, loupe à droite, marge sombre à gauche",
      focalEmotion: "découverte",
      textOverlay: { text: "SON JOURNAL", placement: "center", colorHex: "#F5E6C8", strokeHex: "#1F2937", fontStyle: "serif-impact" },
      aspectRatio: "16:9",
    },
  ],
};

// Même enchaînement qu'une génération : chaque asset est post-traité avec le contexte des précédents.
function buildContent() {
  const ctx: PromptContext = { brief, channel: null };
  const script = registry.script.postProcess(rawScript, ctx);
  const derived = { ...ctx, script };
  const titles = registry.titles.postProcess(rawTitles, derived);
  return {
    script,
    titles,
    seo: registry.seo.postProcess(rawSeo, derived),
    voiceover: registry.voiceover.postProcess(rawVoiceover, derived),
    thumbnails: registry.thumbnails.postProcess(rawThumbnails, { ...derived, titles }),
  };
}

const content = buildContent();
const base = { brief, tier: "standard" as const, createdAt: "2026-10-24T09:30:00.000Z" };

const firstVersion = (type: string, minutes = 0): VersionSummary[] => [
  { id: `${type}-v1`, version: 1, source: "ai", createdAt: new Date(Date.parse(base.createdAt) + 60_000 * (1 + minutes)).toISOString() },
];
const ready = <K extends AssetType>(value: AssetView<K>["content"], versions: VersionSummary[]): AssetView<K> => ({
  status: "ready",
  content: value,
  error: null,
  stale: false,
  versions,
});
const failed = <K extends AssetType>(code: string): AssetView<K> => ({
  status: "failed",
  content: null,
  error: { code },
  stale: false,
  versions: [],
});
const skipped = <K extends AssetType>(): AssetView<K> => ({ status: "skipped", content: null, error: null, stale: false, versions: [] });

function completedView(id: string): PipelineView {
  return {
    ...emptyPipelineView({ id, ...base }),
    status: "completed",
    assets: {
      script: ready(content.script, firstVersion("script")),
      titles: ready(content.titles, firstVersion("titles", 1)),
      seo: ready(content.seo, firstVersion("seo", 1)),
      voiceover: ready(content.voiceover, firstVersion("voiceover", 1)),
      thumbnails: ready(content.thumbnails, firstVersion("thumbnails", 2)),
    },
  };
}

function partialView(): PipelineView {
  const view = completedView("demo-partial");
  return {
    ...view,
    status: "partial",
    assets: {
      ...view.assets,
      seo: failed("CONTENT_REFUSED"),
    },
  };
}

function failedView(): PipelineView {
  return {
    ...emptyPipelineView({ id: "demo-failed", ...base }),
    status: "failed",
    assets: {
      script: failed("PROVIDER_ERROR"),
      titles: skipped(),
      seo: skipped(),
      voiceover: skipped(),
      thumbnails: skipped(),
    },
  };
}

// Script retouché à la main après la génération : les quatre dérivés, produits à partir de la
// première version, sont obsolètes.
function staleView(): PipelineView {
  const view = completedView("demo-stale");
  const editedScript = registry.script.postProcess(
    {
      ...content.script,
      workingTitle: "Gizeh : le chantier qui défie les ingénieurs",
      scenes: content.script.scenes.map((scene, i) =>
        i === 0 ? { ...scene, narration: "Deux tonnes et demie par bloc. Plus de deux millions de blocs. Et toujours aucune certitude sur la façon dont ils ont été hissés." } : scene,
      ),
    },
    { brief, channel: null },
  );
  const derived = ["titles", "seo", "voiceover", "thumbnails"] as const;
  const assets = { ...view.assets };
  for (const type of derived) assets[type] = { ...view.assets[type], stale: true } as never;
  return {
    ...view,
    staleCredits: regenerationCredits([...derived], brief, base.tier),
    assets: {
      ...assets,
      script: ready(editedScript, [
        { id: "script-v2", version: 2, source: "user_edit", createdAt: "2026-10-24T11:05:00.000Z" },
        ...firstVersion("script"),
      ]),
    },
  };
}

export type DemoPipeline =
  | { replay: false; view: PipelineView; example?: ExampleMeta } // `example` : sortie réelle des modèles
  | { replay: true; view: PipelineView; final: PipelineView }; // rejoue la génération en direct

export function demoPipeline(id: string): DemoPipeline | null {
  switch (id) {
    case "demo-running":
      return { replay: true, view: emptyPipelineView({ id, ...base }), final: completedView(id) };
    case "demo-completed":
      return { replay: false, view: completedView(id) };
    case "demo-partial":
      return { replay: false, view: partialView() };
    case "demo-failed":
      return { replay: false, view: failedView() };
    case "demo-stale":
      return { replay: false, view: staleView() };
    default: {
      const real = example(id);
      return real ? { replay: false, view: real.view, example: real.meta } : null;
    }
  }
}
