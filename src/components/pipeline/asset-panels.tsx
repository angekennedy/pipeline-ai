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
import { PACE_LABELS } from "@/lib/pipeline/labels";
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

export function ScriptPanel({ script }: { script: Script }) {
  return (
    <div>
      <Actions>
        <CopyButton text={scriptToText(script)} label="Copier le script" primary />
        <CopyButton text={narrationToText(script)} label="Copier la narration" />
      </Actions>
      <h2 className="text-lg font-semibold">{script.workingTitle}</h2>
      <p className="mb-4 text-muted-foreground">{script.hookSummary}</p>
      <SceneStream scenes={script.scenes} streaming={false} />
      <Section title="Appel à l'action">
        <p>{script.callToAction}</p>
      </Section>
      {script.factCheckFlags.length > 0 && (
        <Section title="Points à vérifier avant publication">
          <ul className="list-disc pl-5 text-sm">
            {script.factCheckFlags.map((flag, i) => (
              <li key={i}>
                Scène {flag.sceneIndex} : {flag.claim}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

export function TitlesPanel({ titles }: { titles: Titles }) {
  return (
    <div>
      <Actions>
        <CopyButton text={titlesToText(titles)} label="Copier les titres" primary />
      </Actions>
      <ol className="grid gap-2">
        {titles.variants.map((variant, i) => (
          <li key={i} className="rounded-xl border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{variant.title}</span>
              {i === titles.recommendedIndex && <Badge>Recommandé</Badge>}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <CharCounter {...titleCounter(variant.title)} max={YOUTUBE_LIMITS.title.max} label="Titre" />
              <span>· score heuristique {variant.heuristicScore}/10 · {variant.rationale}</span>
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SeoPanel({ seo }: { seo: Seo }) {
  const counters = seoCounters(seo);
  return (
    <div>
      <Actions>
        <CopyButton text={seoToText(seo)} label="Copier la description" primary />
        <CopyButton text={tagsToText(seo)} label="Copier les tags" />
      </Actions>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Description</h2>
        <CharCounter {...counters.description} max={YOUTUBE_LIMITS.description.max} label="Description" />
      </div>
      <div className="mb-3 rounded-lg border bg-muted/40 p-3 text-sm">
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          Visible dans les résultats de recherche ({YOUTUBE_LIMITS.description.preview} premiers caractères)
        </p>
        <p>
          {counters.preview}
          {counters.description.count > YOUTUBE_LIMITS.description.preview && "…"}
        </p>
      </div>
      <p className="whitespace-pre-line">{seo.description}</p>
      <Section title="Chapitres">
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
            Pas de chapitres : YouTube en exige au moins 3, de 10 secondes ou plus.
          </p>
        )}
      </Section>
      <Section title="Tags">
        <p className="mb-2">
          <CharCounter {...counters.tags} max={YOUTUBE_LIMITS.tags.max} label="Tags" />
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
        <Section title="Hashtags">
          <p>{seo.hashtags.join(" ")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {counters.hashtags.count} sur {YOUTUBE_LIMITS.hashtags.shown} affichés au-dessus du titre
          </p>
        </Section>
      )}
    </div>
  );
}

export function VoiceoverPanel({ voiceover }: { voiceover: Voiceover }) {
  const { gender, age, accent, baseStyle } = voiceover.globalVoice;
  return (
    <div>
      <Actions>
        <CopyButton text={voiceoverToText(voiceover)} label="Copier les indications" primary />
      </Actions>
      <p className="mb-4 text-sm">
        <span className="font-medium">Voix :</span> {gender}, {age}, {accent}. {baseStyle}
      </p>
      <ol className="grid gap-3">
        {voiceover.segments.map((segment) => (
          <li key={segment.sceneIndex} className="rounded-xl border p-3">
            <p className="mb-1 text-sm text-muted-foreground">
              Scène {segment.sceneIndex} · rythme {PACE_LABELS[segment.pace]} · {segment.emotion} · pause {segment.pauseAfterMs} ms
            </p>
            <p>{segment.text}</p>
            {segment.pronunciationHints.length > 0 && (
              <p className="mt-1 text-sm">
                Prononciation : {segment.pronunciationHints.map((hint) => `${hint.word} → ${hint.phonetic}`).join(", ")}
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
export function ThumbnailsPanel({ thumbnails, titles, durationMinutes }: { thumbnails: Thumbnails; titles: Titles | null; durationMinutes: number }) {
  return (
    <div>
      <Actions>
        <CopyButton text={thumbnailsToText(thumbnails, titles)} label="Copier les concepts" primary />
      </Actions>
      <ul className="grid gap-3 md:grid-cols-2">
        {thumbnails.concepts.map((concept, i) => {
          const { text, placement, fontStyle } = concept.textOverlay;
          const title = titles?.variants[concept.pairedTitleIndex]?.title;
          return (
            <li key={i} className="rounded-xl border p-3">
              <h2 className="font-medium">Concept {i + 1}</h2>
              {title && <p className="text-sm text-muted-foreground">Pour « {title} »</p>}
              {/* Aperçu mobile : fil d'accueil et colonne des suggestions, texte incrusté sur fond neutre. */}
              <div className="my-3 flex flex-wrap items-start gap-3" role="group" aria-label={`Aperçu mobile du concept ${i + 1}`}>
                <ThumbnailPreview concept={concept} title={title ?? null} durationMinutes={durationMinutes} size="feed" />
                <ThumbnailPreview concept={concept} title={title ?? null} durationMinutes={durationMinutes} size="suggested" />
              </div>
              {placement === "bottom-right" && (
                <p className="mb-2 text-sm text-amber-700 dark:text-amber-400">Le badge de durée de YouTube recouvre ce coin : placez le texte ailleurs.</p>
              )}
              <p className="text-sm">
                Texte « {text} » · {placement} · {fontStyle} · {concept.focalEmotion}
              </p>
              <p className="mt-2 text-sm">{concept.imagePrompt}</p>
              <p className="mt-1 text-sm text-muted-foreground">Négatif : {concept.negativePrompt}</p>
              <p className="mt-1 text-sm text-muted-foreground">{concept.composition}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
