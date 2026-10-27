import { strToU8, Zip, ZipDeflate, ZipPassThrough, zipSync } from "fflate";
import type { Translator } from "@/i18n/types";
import type { PipelineView } from "@/lib/pipeline/view";
import { scriptToSrt } from "./srt";
import { scriptSpokenText, voiceoverSpokenText } from "./spoken";
import { scriptToText, seoToText, tagsToText, thumbnailsToText, titlesToText, voiceoverToText } from "./text";

// Exports d'un pipeline (tâche 4.1) : Markdown, JSON, voix off pour ElevenLabs, sous-titres SRT, et une
// archive ZIP qui les réunit. Seules les versions courantes des assets prêts sont exportées. Intitulés
// et rappel dans la langue de l'interface (`t`), contenu dans celle de la vidéo.

// Rappel joint à chaque export (ARCHITECTURE, vérification produit) : YouTube demande de déclarer un
// contenu réaliste modifié ou synthétique, et sa politique vise les contenus répétitifs produits en masse.
export const aiDisclosure = (t: Translator) =>
  [t("Export.disclosure.title"), t("Export.disclosure.facts"), t("Export.disclosure.synthetic"), t("Export.disclosure.originality")].join("\n");

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

export function pipelineToMarkdown(view: PipelineView, t: Translator): string {
  const script = ready(view, "script");
  const titles = ready(view, "titles");
  const seo = ready(view, "seo");
  const voiceover = ready(view, "voiceover");
  const thumbnails = ready(view, "thumbnails");
  const { brief } = view;
  const section = (title: string, body: string | null) => (body ? `## ${title}\n\n${body}` : null);
  return [
    `# ${brief.topic}`,
    [
      t("Export.meta.niche", { value: brief.niche }),
      t("Export.meta.duration", { minutes: brief.durationMinutes }),
      t("Export.meta.language", { value: t(`Labels.language.${brief.language}`) }),
      view.channelName && t("Export.meta.preset", { value: view.channelName }),
    ]
      .filter(Boolean)
      .join("\n"),
    aiDisclosure(t)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
    section(t("Export.section.titles"), titles && titlesToText(titles, t)),
    section(t("Export.section.script"), script && scriptToText(script, t)),
    section(t("Export.section.description"), seo && seoToText(seo)),
    section(t("Export.section.tags"), seo && tagsToText(seo)),
    section(t("Export.section.voiceover"), voiceover && voiceoverToText(voiceover, t)),
    section(t("Export.section.thumbnails"), thumbnails && thumbnailsToText(thumbnails, titles, t)),
  ]
    .filter(Boolean)
    .join("\n\n")
    .concat("\n");
}

export function pipelineToJson(view: PipelineView, t: Translator, exportedAt = new Date()): string {
  return `${JSON.stringify(
    {
      exportedAt: exportedAt.toISOString(),
      aiDisclosure: aiDisclosure(t),
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
// `attached` : fichiers ajoutés à l'archive en plus de ceux-ci (médias), listés dans le LISEZ-MOI.
export function exportBundle(view: PipelineView, t: Translator, exportedAt = new Date(), attached: string[] = []): ExportFile[] {
  const script = ready(view, "script");
  const titles = ready(view, "titles");
  const seo = ready(view, "seo");
  const voiceover = ready(view, "voiceover");
  const thumbnails = ready(view, "thumbnails");
  const speech = pipelineToSpeech(view);
  const srt = pipelineToSrt(view);
  const files: Array<ExportFile | null> = [
    { name: "pipeline.md", type: "text/markdown; charset=utf-8", body: pipelineToMarkdown(view, t) },
    { name: "pipeline.json", type: "application/json", body: pipelineToJson(view, t, exportedAt) },
    speech ? { name: "voix-off-elevenlabs.txt", type: TEXT, body: speech } : null,
    srt ? { name: "sous-titres.srt", type: "application/x-subrip", body: srt } : null,
    script ? { name: "script.txt", type: TEXT, body: `${scriptToText(script, t)}\n` } : null,
    titles ? { name: "titres.txt", type: TEXT, body: `${titlesToText(titles, t)}\n` } : null,
    seo ? { name: "description-youtube.txt", type: TEXT, body: `${seoToText(seo)}\n` } : null,
    seo ? { name: "tags.txt", type: TEXT, body: `${tagsToText(seo)}\n` } : null,
    voiceover ? { name: "voix-off-indications.txt", type: TEXT, body: `${voiceoverToText(voiceover, t)}\n` } : null,
    thumbnails ? { name: "miniatures.txt", type: TEXT, body: `${thumbnailsToText(thumbnails, titles, t)}\n` } : null,
  ];
  const present = files.filter((file): file is ExportFile => file !== null);
  const readme = [view.brief.topic, "", aiDisclosure(t), "", t("Export.files"), ...[...present.map((file) => file.name), ...attached].map((name) => `- ${name}`), ""].join("\n");
  return [{ name: "LISEZ-MOI.txt", type: TEXT, body: readme }, ...present];
}

// Médias joints à l'archive : images des miniatures et, quand la vidéo est prête, ce qui a servi à la
// monter. Le MP4 reste un lien : trop lourd pour l'archive, il est hébergé par Shotstack.
export type MediaEntry = { name: string; path: string };

const pad = (n: number, width: number) => String(n).padStart(width, "0");

export function mediaEntries(view: PipelineView): MediaEntry[] {
  const thumbnails = ready(view, "thumbnails");
  const video = view.video?.status === "ready" ? view.video.content : null;
  return [
    ...(thumbnails?.concepts ?? []).flatMap((concept, i) => (concept.imagePath ? [{ name: `miniatures/miniature-${i + 1}.jpg`, path: concept.imagePath }] : [])),
    ...(video
      ? [
          { name: "video/sous-titres-video.srt", path: video.captionsPath },
          ...video.voice.map((voice) => ({ name: `video/voix-off/scene-${pad(voice.sceneIndex, 2)}.mp3`, path: voice.path })),
          ...video.shots.map((shot, i) => ({ name: `video/images/plan-${pad(i + 1, 3)}.jpg`, path: shot.imagePath })),
        ]
      : []),
  ];
}

// Archive en flux, pour les pipelines avec médias : chaque média est lu puis écrit à son tour, sans
// tout garder en mémoire. Images et MP3, déjà compressés, sont stockés tels quels.
export function pipelineToZipStream(
  view: PipelineView,
  t: Translator,
  readMedia: (path: string) => Promise<Uint8Array>,
  exportedAt = new Date(),
): ReadableStream<Uint8Array> {
  const media = mediaEntries(view);
  const video = view.video?.status === "ready" ? view.video.content : null;
  const extra: ExportFile[] = video ? [{ name: "video/lien-video.txt", type: TEXT, body: `${t("Export.videoLink", { url: video.url })}\n` }] : [];
  const files = exportBundle(view, t, exportedAt, [...extra.map((file) => file.name), ...media.map((entry) => entry.name)]);
  return new ReadableStream({
    async start(controller) {
      const zip = new Zip((error, chunk, final) => {
        if (error) return controller.error(error);
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      const add = (name: string, data: Uint8Array, compress: boolean) => {
        const entry = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
        entry.mtime = exportedAt;
        zip.add(entry);
        entry.push(data, true);
      };
      try {
        for (const file of [...files, ...extra]) add(file.name, typeof file.body === "string" ? strToU8(file.body) : file.body, true);
        for (const entry of media) add(entry.name, await readMedia(entry.path), entry.name.endsWith(".srt"));
        zip.end();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

export function pipelineToZip(view: PipelineView, t: Translator, exportedAt = new Date()): Uint8Array {
  const mtime = exportedAt;
  return zipSync(
    Object.fromEntries(exportBundle(view, t, exportedAt).map((file) => [file.name, [typeof file.body === "string" ? strToU8(file.body) : file.body, { mtime }]])),
    { level: 6 },
  );
}
