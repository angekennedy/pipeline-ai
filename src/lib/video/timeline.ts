import type { Clip, Edit } from "@/lib/media/shotstack";

// Montage Shotstack : les images plein cadre avec un zoom lent alterné et un fondu entre deux plans,
// la voix off scène par scène, les sous-titres incrustés en bas. Les pistes sont superposées dans
// l'ordre du tableau, la dernière au-dessus.

export type TimelineInput = {
  shots: Array<{ start: number; length: number; src: string }>;
  voices: Array<{ start: number; duration: number; src: string }>;
  captionsSrc: string;
  durationSeconds: number;
};

// Recouvrement de deux images pendant le fondu, en secondes.
const CROSSFADE = 0.5;
const EFFECTS = ["zoomInSlow", "zoomOutSlow"] as const;

export function buildEdit({ shots, voices, captionsSrc, durationSeconds }: TimelineInput): Edit {
  const images: Clip[] = shots.map((shot, i) => ({
    asset: { type: "image", src: shot.src },
    start: shot.start,
    // L'image déborde sur la suivante le temps du fondu, sauf la dernière.
    length: i === shots.length - 1 ? shot.length : shot.length + CROSSFADE,
    fit: "cover",
    effect: EFFECTS[i % EFFECTS.length],
    transition: { in: i === 0 ? "fade" : "fadeSlow", ...(i === shots.length - 1 && { out: "fade" }) },
  }));
  const audio: Clip[] = voices.map((voice) => ({ asset: { type: "audio", src: voice.src, volume: 1 }, start: voice.start, length: voice.duration }));
  const captions: Clip[] = [
    {
      asset: {
        type: "caption",
        src: captionsSrc,
        font: { family: "Montserrat ExtraBold", color: "#ffffff", size: 38, lineHeight: 1.1, stroke: "#000000", strokeWidth: 2 },
        // Position par défaut de Shotstack : centré en bas de l'image.
        background: { color: "#000000", opacity: 0.45, padding: 14, borderRadius: 10 },
      },
      start: 0,
      length: durationSeconds,
    },
  ];

  return {
    timeline: { background: "#000000", tracks: [{ clips: images }, { clips: audio }, { clips: captions }] },
    output: { format: "mp4", resolution: "1080", fps: 25, quality: "high" },
  };
}
