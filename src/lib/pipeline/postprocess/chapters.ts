import type { Scene } from "@/lib/ai/schemas/script";
import type { Chapter, Seo } from "@/lib/ai/schemas/seo";

// Règles YouTube : premier chapitre à 00:00, au moins 3 chapitres, chacun d'au moins 10 s.
export const MIN_CHAPTERS = 3;
export const MIN_CHAPTER_SECONDS = 10;

export type ChaptersResult =
  | { ok: true; chapters: Chapter[] }
  | { ok: false; reason: "TOO_FEW_CHAPTERS"; chapters: [] };

const pad = (n: number) => String(n).padStart(2, "0");

export function formatTimestamp(seconds: number): string {
  const s = Math.floor(seconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

export function buildChapters(
  scenes: Pick<Scene, "index" | "estimatedSeconds">[],
  chapterTitles: Seo["chapterTitles"],
): ChaptersResult {
  const startOf = new Map<number, number>();
  let totalSeconds = 0;
  for (const scene of scenes) {
    startOf.set(scene.index, totalSeconds);
    totalSeconds += scene.estimatedSeconds;
  }

  // Tri stable : en cas de doublon sur une scène, le premier titre proposé l'emporte.
  const seen = new Set<number>();
  const chapters = [...chapterTitles]
    .sort((a, b) => a.startsAtSceneIndex - b.startsAtSceneIndex)
    .filter(({ startsAtSceneIndex: i }) => startOf.has(i) && !seen.has(i) && seen.add(i))
    .map(({ startsAtSceneIndex, title }) => ({ start: startOf.get(startsAtSceneIndex)!, title }));

  if (chapters[0]) chapters[0].start = 0;

  // Un chapitre trop court est fusionné dans le précédent ; le premier absorbe le suivant.
  let i = 0;
  while (i < chapters.length && chapters.length > 1) {
    const end = chapters[i + 1]?.start ?? totalSeconds;
    if (end - chapters[i]!.start >= MIN_CHAPTER_SECONDS) {
      i++;
    } else {
      chapters.splice(i === 0 ? 1 : i, 1);
    }
  }

  if (chapters.length < MIN_CHAPTERS) return { ok: false, reason: "TOO_FEW_CHAPTERS", chapters: [] };
  return { ok: true, chapters: chapters.map(({ start, title }) => ({ timestamp: formatTimestamp(start), title })) };
}
