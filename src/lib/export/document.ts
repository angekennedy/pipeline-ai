import { strToU8, zipSync } from "fflate";
import type { PipelineView } from "@/lib/pipeline/view";
import { scriptToSrt } from "./srt";
import { scriptSpokenText, voiceoverSpokenText } from "./spoken";
import { scriptToText, seoToText, tagsToText, thumbnailsToText, titlesToText, voiceoverToText } from "./text";

// Exports d'un pipeline (tâche 4.1) : Markdown, JSON, voix off pour ElevenLabs, sous-titres SRT, et une
// archive ZIP qui les réunit. Seules les versions courantes des assets prêts sont exportées.

// Rappel joint à chaque export (ARCHITECTURE, vérification produit) : YouTube demande de déclarer un
// contenu réaliste modifié ou synthétique, et sa politique vise les contenus répétitifs produits en masse.
export const AI_DISCLOSURE = [
  "Contenu généré avec l'aide de l'IA (Pipeline AI).",
  "- Avant la mise en ligne, vérifiez les faits signalés dans le script.",
  "- Si la vidéo montre ou fait entendre un contenu réaliste qui pourrait passer pour réel (voix de synthèse imitant une personne, images générées de lieux ou d'événements réels), déclarez-le dans YouTube Studio : Détails, « Contenu modifié ou synthétique ».",
  "- Apportez votre valeur propre (angle, montage, commentaire) : YouTube ne monétise pas les contenus répétitifs ou produits en masse.",
].join("\n");

export type ExportFormat = "md" | "json" | "txt" | "srt" | "zip";
export const EXPORT_FORMATS: readonly ExportFormat[] = ["md", "json", "txt", "srt", "zip"];

export type ExportFile = { name: string; type: string; body: string | Uint8Array };

const ready = <K extends keyof PipelineView["assets"]>(view: PipelineView, type: K) => (view.assets[type].status === "ready" ? view.assets[type].content : null);

// Nom de fichier lisible et sûr, tiré du sujet : minuscules, sans accents ni ponctuation.
export function exportBaseName(view: PipelineView): string {
  const slug = view.brief.topic
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
  return `pipeline-${slug || view.id.slice(0, 8)}`;
}

export function pipelineToMarkdown(view: PipelineView): string {
  const script = ready(view, "script");
  const titles = ready(view, "titles");
  const seo = ready(view, "seo");
  const voiceover = ready(view, "voiceover");
  const thumbnails = ready(view, "thumbnails");
  const { brief } = view;
  const section = (title: string, body: string | null) => (body ? `## ${title}\n\n${body}` : null);
  return [
    `# ${brief.topic}`,
    [`- Niche : ${brief.niche}`, `- Durée cible : ${brief.durationMinutes} min`, `- Langue : ${brief.language}`, view.channelName && `- Preset : ${view.channelName}`]
      .filter(Boolean)
      .join("\n"),
    AI_DISCLOSURE.split("\n").map((line) => `> ${line}`).join("\n"),
    section("Titres", titles && titlesToText(titles)),
    section("Script", script && scriptToText(script)),
    section("Description YouTube", seo && seoToText(seo)),
    section("Tags", seo && tagsToText(seo)),
    section("Voix off", voiceover && voiceoverToText(voiceover)),
    section("Miniatures", thumbnails && thumbnailsToText(thumbnails, titles)),
  ]
    .filter(Boolean)
    .join("\n\n")
    .concat("\n");
}

export function pipelineToJson(view: PipelineView, exportedAt = new Date()): string {
  return `${JSON.stringify(
    {
      exportedAt: exportedAt.toISOString(),
      aiDisclosure: AI_DISCLOSURE,
      pipeline: { id: view.id, status: view.status, tier: view.tier, createdAt: view.createdAt, brief: view.brief, channel: view.channelName ?? null },
      assets: {
        script: ready(view, "script"),
        titles: ready(view, "titles"),
        seo: ready(view, "seo"),
        voiceover: ready(view, "voiceover"),
        thumbnails: ready(view, "thumbnails"),
      },
    },
    null,
    2,
  )}\n`;
}

// Voix off à coller dans ElevenLabs : la voix off si elle est prête, sinon la narration du script.
export function pipelineToSpeech(view: PipelineView): string | null {
  const voiceover = ready(view, "voiceover");
  const script = ready(view, "script");
  if (voiceover) return `${voiceoverSpokenText(voiceover)}\n`;
  return script ? `${scriptSpokenText(script)}\n` : null;
}

export function pipelineToSrt(view: PipelineView): string | null {
  const script = ready(view, "script");
  return script ? scriptToSrt(script, ready(view, "voiceover")) : null;
}

const TEXT = "text/plain; charset=utf-8";

// Contenu de l'archive : un fichier par usage, et un LISEZ-MOI avec le rappel de déclaration.
export function exportBundle(view: PipelineView, exportedAt = new Date()): ExportFile[] {
  const script = ready(view, "script");
  const titles = ready(view, "titles");
  const seo = ready(view, "seo");
  const voiceover = ready(view, "voiceover");
  const thumbnails = ready(view, "thumbnails");
  const speech = pipelineToSpeech(view);
  const srt = pipelineToSrt(view);
  const files: Array<ExportFile | null> = [
    { name: "pipeline.md", type: "text/markdown; charset=utf-8", body: pipelineToMarkdown(view) },
    { name: "pipeline.json", type: "application/json", body: pipelineToJson(view, exportedAt) },
    speech ? { name: "voix-off-elevenlabs.txt", type: TEXT, body: speech } : null,
    srt ? { name: "sous-titres.srt", type: "application/x-subrip", body: srt } : null,
    script ? { name: "script.txt", type: TEXT, body: `${scriptToText(script)}\n` } : null,
    titles ? { name: "titres.txt", type: TEXT, body: `${titlesToText(titles)}\n` } : null,
    seo ? { name: "description-youtube.txt", type: TEXT, body: `${seoToText(seo)}\n` } : null,
    seo ? { name: "tags.txt", type: TEXT, body: `${tagsToText(seo)}\n` } : null,
    voiceover ? { name: "voix-off-indications.txt", type: TEXT, body: `${voiceoverToText(voiceover)}\n` } : null,
    thumbnails ? { name: "miniatures.txt", type: TEXT, body: `${thumbnailsToText(thumbnails, titles)}\n` } : null,
  ];
  const present = files.filter((file): file is ExportFile => file !== null);
  const readme = [`${view.brief.topic}`, "", AI_DISCLOSURE, "", "Fichiers :", ...present.map((file) => `- ${file.name}`), ""].join("\n");
  return [{ name: "LISEZ-MOI.txt", type: TEXT, body: readme }, ...present];
}

export function pipelineToZip(view: PipelineView, exportedAt = new Date()): Uint8Array {
  const mtime = exportedAt;
  return zipSync(
    Object.fromEntries(exportBundle(view, exportedAt).map((file) => [file.name, [typeof file.body === "string" ? strToU8(file.body) : file.body, { mtime }]])),
    { level: 6 },
  );
}
