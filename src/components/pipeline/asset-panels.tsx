import { useTranslations } from "next-intl";
import type { Script, Seo, Thumbnails, Titles, Voiceover } from "@/lib/ai/schemas";
import {
  narrationToText,
  scriptToText,
  seoToText,
  tagsToText,
  thumbnailsToText,
  titlesToText,
  voiceoverToText,
} from "@/lib/export/text";
import { YOUTUBE_LIMITS, seoCounters, titleCounter } from "@/lib/pipeline/youtube-limits";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "./copy-button";
import { SceneStream } from "./scene-stream";
import { CharCounter, ThumbnailPreview } from "./youtube-preview";

// Rendu de chaque asset terminé. Tout le contenu vient du modèle : il est rendu en texte par React,
// jamais en HTML. Intertitres en h2, sous le h1 de la page : l'ordre des titres reste continu.

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 flex flex-wrap gap-2">{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

// `all` : traducteur sans espace de noms, pour les textes à copier (src/lib/export/text.ts).
function usePanelTranslations() {
  return { t: useTranslations("Panels"), all: useTranslations() };
}

export function ScriptPanel({ script }: { script: Script }) {
  const { t, all } = usePanelTranslations();
  return (
    <div>
      <Actions>
        <CopyButton text={scriptToText(script, all)} label={t("copyScript")} primary />
        <CopyButton text={narrationToText(script)} label={t("copyNarration")} />
      </Actions>
      <h2 className="text-lg font-semibold">{script.workingTitle}</h2>
      <p className="mb-4 text-muted-foreground">{script.hookSummary}</p>
      <SceneStream scenes={script.scenes} streaming={false} />
      <Section title={t("callToAction")}>
        <p>{script.callToAction}</p>
      </Section>
      {script.factCheckFlags.length > 0 && (
        <Section title={t("factChecks")}>
          <ul className="list-disc pl-5 text-sm">
            {script.factCheckFlags.map((flag, i) => (
              <li key={i}>
                {t("factCheck", { scene: flag.sceneIndex, claim: flag.claim })}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

export function TitlesPanel({ titles }: { titles: Titles }) {
  const { t, all } = usePanelTranslations();
  return (
    <div>
      <Actions>
        <CopyButton text={titlesToText(titles, all)} label={t("copyTitles")} primary />
      </Actions>
      <ol className="grid gap-2">
        {titles.variants.map((variant, i) => (
          <li key={i} className="rounded-xl border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{variant.title}</span>
              {i === titles.recommendedIndex && <Badge>{t("recommended")}</Badge>}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <CharCounter {...titleCounter(variant.title)} max={YOUTUBE_LIMITS.title.max} label={t("titleCounter")} />
              <span>{t("titleMeta", { score: variant.heuristicScore, rationale: variant.rationale })}</span>
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SeoPanel({ seo }: { seo: Seo }) {
  const { t } = usePanelTranslations();
  const counters = seoCounters(seo);
  return (
    <div>
      <Actions>
        <CopyButton text={seoToText(seo)} label={t("copyDescription")} primary />
        <CopyButton text={tagsToText(seo)} label={t("copyTags")} />
      </Actions>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("description")}</h2>
        <CharCounter {...counters.description} max={YOUTUBE_LIMITS.description.max} label={t("description")} />
      </div>
      <div className="mb-3 rounded-lg border bg-muted/40 p-3 text-sm">
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          {t("preview", { count: YOUTUBE_LIMITS.description.preview })}
        </p>
        <p>
          {counters.preview}
          {counters.description.count > YOUTUBE_LIMITS.description.preview && "…"}
        </p>
      </div>
      <p className="whitespace-pre-line">{seo.description}</p>
      <Section title={t("chapters")}>
        {seo.chapters && seo.chapters.length > 0 ? (
          <ul className="grid gap-1 text-sm">
            {seo.chapters.map((chapter) => (
              <li key={chapter.timestamp}>
                <span className="font-mono">{chapter.timestamp}</span> {chapter.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("noChapters")}
          </p>
        )}
      </Section>
      <Section title={t("tags")}>
        <p className="mb-2">
          <CharCounter {...counters.tags} max={YOUTUBE_LIMITS.tags.max} label={t("tags")} />
        </p>
        <div className="flex flex-wrap gap-1">
          {seo.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      </Section>
      {seo.hashtags.length > 0 && (
        <Section title={t("hashtags")}>
          <p>{seo.hashtags.join(" ")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("hashtagsShown", { count: counters.hashtags.count, max: YOUTUBE_LIMITS.hashtags.shown })}
          </p>
        </Section>
      )}
    </div>
  );
}

export function VoiceoverPanel({ voiceover }: { voiceover: Voiceover }) {
  const { t, all } = usePanelTranslations();
  const { gender, age, accent, baseStyle } = voiceover.globalVoice;
  return (
    <div>
      <Actions>
        <CopyButton text={voiceoverToText(voiceover, all)} label={t("copyDirections")} primary />
      </Actions>
      <p className="mb-4 text-sm">
        <span className="font-medium">{t("voice")}</span> {gender}, {age}, {accent}. {baseStyle}
      </p>
      <ol className="grid gap-3">
        {voiceover.segments.map((segment) => (
          <li key={segment.sceneIndex} className="rounded-xl border p-3">
            <p className="mb-1 text-sm text-muted-foreground">
              {t("segment", { scene: segment.sceneIndex, pace: all(`Labels.pace.${segment.pace}`), emotion: segment.emotion, ms: segment.pauseAfterMs })}
            </p>
            <p>{segment.text}</p>
            {segment.pronunciationHints.length > 0 && (
              <p className="mt-1 text-sm">
                {t("pronunciation", { text: segment.pronunciationHints.map((hint) => `${hint.word} → ${hint.phonetic}`).join(", ") })}
              </p>
            )}
            <p className="mt-1 text-sm text-muted-foreground">{segment.providerPrompt}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

// `durationMinutes` : badge de durée de l'aperçu, celui que YouTube superpose en bas à droite.
// `media` : liens signés des images générées, par chemin (load-view) ; sans image, l'aperçu reste schématique.
export function ThumbnailsPanel({
  thumbnails,
  titles,
  durationMinutes,
  media = {},
}: {
  thumbnails: Thumbnails;
  titles: Titles | null;
  durationMinutes: number;
  media?: Record<string, string>;
}) {
  const { t, all } = usePanelTranslations();
  return (
    <div>
      <Actions>
        <CopyButton text={thumbnailsToText(thumbnails, titles, all)} label={t("copyConcepts")} primary />
      </Actions>
      <ul className="grid gap-3 md:grid-cols-2">
        {thumbnails.concepts.map((concept, i) => {
          const { text, placement, fontStyle } = concept.textOverlay;
          const title = titles?.variants[concept.pairedTitleIndex]?.title;
          const imageUrl = concept.imagePath ? media[concept.imagePath] : undefined;
          return (
            <li key={i} className="rounded-xl border p-3">
              <h2 className="font-medium">{t("concept", { index: i + 1 })}</h2>
              {title && <p className="text-sm text-muted-foreground">{t("conceptFor", { title })}</p>}
              {/* Aperçu mobile : fil d'accueil et colonne des suggestions, texte incrusté sur fond neutre. */}
              <div className="my-3 flex flex-wrap items-start gap-3" role="group" aria-label={t("conceptPreview", { index: i + 1 })}>
                <ThumbnailPreview concept={concept} title={title ?? null} durationMinutes={durationMinutes} size="feed" imageUrl={imageUrl} />
                <ThumbnailPreview concept={concept} title={title ?? null} durationMinutes={durationMinutes} size="suggested" imageUrl={imageUrl} />
              </div>
              {imageUrl && (
                <a href={imageUrl} download className="mb-2 inline-block text-sm font-medium underline underline-offset-4">
                  {t("downloadImage", { index: i + 1 })}
                </a>
              )}
              {placement === "bottom-right" && (
                <p className="mb-2 text-sm text-amber-700 dark:text-amber-400">{t("badgeOverlap")}</p>
              )}
              <p className="text-sm">
                {t("overlay", { text, placement, font: fontStyle, emotion: concept.focalEmotion })}
              </p>
              <p className="mt-2 text-sm">{concept.imagePrompt}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("negative", { text: concept.negativePrompt })}</p>
              <p className="mt-1 text-sm text-muted-foreground">{concept.composition}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
