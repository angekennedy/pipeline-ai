// Jeux de données valides, partagés par les tests de schémas et de post-traitement.
// Chaque test part d'une copie (`structuredClone`) et casse un seul champ.

export const validBrief = {
  niche: "Histoire",
  topic: "Le mystère de la construction des pyramides de Gizeh",
  language: "fr",
  tone: "mysterious",
  durationMinutes: 8,
  style: "documentary",
} as const;

const narration = (n: number) =>
  `Scène ${n} : il y a plus de quatre mille ans, des milliers d'ouvriers ont déplacé des blocs de plusieurs tonnes.`;

export const validScript = {
  workingTitle: "Comment les pyramides ont vraiment été construites",
  hookSummary: "Une rampe cachée change tout ce que l'on croyait savoir.",
  scenes: [
    { index: 1, purpose: "hook", title: "Le bloc impossible", narration: narration(1), visualDirection: "Plan drone au lever du soleil", bRollKeywords: ["pyramide", "désert"], onScreenText: "2,5 tonnes", estimatedSeconds: 12 },
    { index: 2, purpose: "context", title: "Gizeh, 2560 av. J.-C.", narration: narration(2), visualDirection: "Carte animée du Nil", bRollKeywords: ["Nil", "carte"], onScreenText: null, estimatedSeconds: 40 },
    { index: 3, purpose: "development", title: "La rampe intérieure", narration: narration(3), visualDirection: "Modélisation 3D en coupe", bRollKeywords: ["rampe", "3D"], onScreenText: null, estimatedSeconds: 60 },
    { index: 4, purpose: "cta", title: "À vous de juger", narration: narration(4), visualDirection: "Retour au plan d'ouverture", bRollKeywords: [], onScreenText: "Abonnez-vous", estimatedSeconds: 15 },
  ],
  callToAction: "Abonnez-vous pour le prochain mystère de l'Égypte ancienne.",
  factCheckFlags: [{ sceneIndex: 2, claim: "Construction vers 2560 av. J.-C." }],
};

export const validTitles = {
  variants: [
    { title: "Le secret des pyramides enfin révélé", angle: "curiosity_gap", rationale: "Promesse de révélation", heuristicScore: 8, charCount: 36 },
    { title: "3 théories sur les pyramides de Gizeh", angle: "number", rationale: "Chiffre concret", heuristicScore: 7, charCount: 37 },
    { title: "Pourquoi personne ne sait bâtir ça", angle: "question", rationale: "Question ouverte", heuristicScore: 6, charCount: 34 },
    { title: "Ce qu'on vous a caché sur Gizeh", angle: "negative", rationale: "Biais de négativité", heuristicScore: 7, charCount: 31 },
    { title: "L'ingénieur qui a percé le mystère", angle: "story", rationale: "Angle narratif", heuristicScore: 6, charCount: 34 },
  ],
  recommendedIndex: 0,
};

export const validSeo = {
  description: "Comment les Égyptiens ont-ils bâti la grande pyramide ? Enquête sur la théorie de la rampe intérieure.",
  tags: ["pyramides", "égypte ancienne", "gizeh"],
  hashtags: ["#pyramides", "#histoire"],
  chapterTitles: [
    { startsAtSceneIndex: 1, title: "Le bloc impossible" },
    { startsAtSceneIndex: 2, title: "Le contexte" },
    { startsAtSceneIndex: 3, title: "La rampe intérieure" },
  ],
};

export const validVoiceover = {
  globalVoice: { gender: "male", age: "40-50", accent: "français standard", baseStyle: "Narrateur grave et posé" },
  segments: [
    { sceneIndex: 1, text: "Il y a plus de quatre mille ans… [pause:600ms] un bloc impossible.", pace: "slow", emotion: "mystère", emphasisWords: ["impossible"], pauseAfterMs: 600, pronunciationHints: [{ word: "Gizeh", phonetic: "gi-zè" }], providerPrompt: "Voix grave, chuchotée au début" },
  ],
};

export const validThumbnails = {
  concepts: [1, 2, 3].map((n) => ({
    pairedTitleIndex: n - 1,
    imagePrompt: `Concept ${n} : pyramide de Gizeh au crépuscule, éclairage dramatique, ultra détaillé`,
    negativePrompt: "texte, filigrane, flou",
    composition: "Règle des tiers, sujet à droite",
    focalEmotion: "curiosité",
    textOverlay: { text: "LA RAMPE CACHÉE", placement: "top-left", colorHex: "#FFD400", strokeHex: "#000000", fontStyle: "bold-sans" },
    aspectRatio: "16:9",
  })),
};
