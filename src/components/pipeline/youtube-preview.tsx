import { cn } from "cn";
import { useFormatter, useTranslations } from "next-intl";
import type { ThumbnailConcept } from "@/lib/ai/schemas";
import type { CounterStatus } from "@/lib/pipeline/youtube-limits";

// Aperçus « comme sur YouTube » (tâche 4.3) : compteurs de caractères des champs de YouTube Studio et
// miniature dans le fil mobile, en CSS seulement (aucune image générée).


const STATUS_CLASS: Record<CounterStatus, string> = {
  ok: "text-muted-foreground",
  warn: "text-amber-700 dark:text-amber-400",
  over: "text-destructive",
};


export function CharCounter({ count, max, status, label }: { count: number; max: number; status: CounterStatus; label: string }) {
  const t = useTranslations("Preview");
  const format = useFormatter();
  return (
    <span className={cn("text-xs tabular-nums", STATUS_CLASS[status])}>
      <span aria-hidden="true">
        {format.number(count)} / {format.number(max)}
      </span>
      <span className="sr-only">
        {t("counter", { label, count, max })}
        {status !== "ok" && t(status)}
      </span>
    </span>
  );
}

const PLACEMENT: Record<ThumbnailConcept["textOverlay"]["placement"], string> = {
  "top-left": "items-start justify-start text-left",
  "top-right": "items-start justify-end text-right",
  "bottom-left": "items-end justify-start text-left",
  "bottom-right": "items-end justify-end text-right",
  center: "items-center justify-center text-center",
};

const FONT: Record<ThumbnailConcept["textOverlay"]["fontStyle"], string> = {
  "bold-sans": "font-sans font-black uppercase",
  condensed: "font-sans font-extrabold uppercase tracking-tighter",
  handwritten: "font-serif italic font-bold",
  "serif-impact": "font-serif font-black uppercase",
};

const duration = (minutes: number) => `${minutes}:00`;

// Miniature au format 16:9 : texte incrusté placé et coloré comme le concept, badge de durée en bas à
// droite (YouTube l'y superpose toujours), titre associé dessous.
export function ThumbnailPreview({
  concept,
  title,
  durationMinutes,
  size,
  imageUrl,
}: {
  concept: ThumbnailConcept;
  title: string | null;
  durationMinutes: number;
  size: "feed" | "suggested";
  imageUrl?: string; // image générée, texte compris : l'incrustation simulée n'est alors pas dessinée
}) {
  const channel = useTranslations("Preview")("channel");
  const { text, placement, colorHex, strokeHex, fontStyle } = concept.textOverlay;
  const feed = size === "feed";
  return (
    <figure className={cn("grid gap-2", feed ? "w-full max-w-[360px]" : "w-[168px]")}>
      <div
        className={cn(
          "relative flex aspect-video overflow-hidden bg-gradient-to-br from-neutral-600 via-neutral-800 to-neutral-950",
          feed ? "rounded-xl p-3" : "rounded-lg p-1.5",
          PLACEMENT[placement],
        )}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- lien signé temporaire, hors de l'optimiseur d'images
          <img src={imageUrl} alt={text} className="absolute inset-0 size-full object-cover" />
        ) : (
          <span
            className={cn("max-w-[85%] leading-none break-words", FONT[fontStyle], feed ? "text-3xl" : "text-sm")}
            style={{ color: colorHex, WebkitTextStroke: `${feed ? 1.5 : 0.75}px ${strokeHex}`, paintOrder: "stroke fill" }}
          >
            {text}
          </span>
        )}
        <span
          className={cn(
            "absolute rounded bg-black/80 font-medium text-white",
            feed ? "right-2 bottom-2 px-1.5 py-0.5 text-xs" : "right-1 bottom-1 px-1 text-[10px]",
          )}
        >
          {duration(durationMinutes)}
        </span>
      </div>
      {title && (
        <figcaption className={cn("flex gap-2", !feed && "text-xs")}>
          {feed && <span aria-hidden="true" className="mt-0.5 size-8 shrink-0 rounded-full bg-muted" />}
          <span className="grid gap-0.5">
            <span className={cn("line-clamp-2 font-medium", feed ? "text-sm" : "text-xs")}>{title}</span>
            <span className="text-xs text-muted-foreground">{channel}</span>
          </span>
        </figcaption>
      )}
    </figure>
  );
}
