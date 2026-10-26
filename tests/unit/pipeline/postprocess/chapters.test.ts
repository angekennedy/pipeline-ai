import { describe, expect, it } from "vitest";
import {
  MIN_CHAPTERS,
  MIN_CHAPTER_SECONDS,
  buildChapters,
  formatTimestamp,
} from "@/lib/pipeline/postprocess/chapters";

const scenes = (...durations: number[]) => durations.map((estimatedSeconds, i) => ({ index: i + 1, estimatedSeconds }));
const titles = (...indexes: number[]) => indexes.map((startsAtSceneIndex) => ({ startsAtSceneIndex, title: `T${startsAtSceneIndex}` }));

describe("formatTimestamp", () => {
  it.each([
    [0, "00:00"],
    [9.9, "00:09"],
    [75, "01:15"],
    [599, "09:59"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3725, "1:02:05"],
  ])("%d s → %s", (seconds, expected) => {
    expect(formatTimestamp(seconds)).toBe(expected);
  });
});

describe("buildChapters", () => {
  it("respecte les règles YouTube : constantes", () => {
    expect(MIN_CHAPTERS).toBe(3);
    expect(MIN_CHAPTER_SECONDS).toBe(10);
  });

  it("horodate chaque chapitre au début de sa scène", () => {
    expect(buildChapters(scenes(12, 40, 60, 15), titles(1, 2, 3))).toEqual({
      ok: true,
      chapters: [
        { timestamp: "00:00", title: "T1" },
        { timestamp: "00:12", title: "T2" },
        { timestamp: "00:52", title: "T3" },
      ],
    });
  });

  it("force le premier chapitre à 00:00", () => {
    const result = buildChapters(scenes(12, 40, 60, 15), titles(2, 3, 4));
    expect(result.chapters.map((c) => c.timestamp)).toEqual(["00:00", "00:52", "01:52"]);
  });

  it("trie les titres, ignore les doublons et les scènes inexistantes", () => {
    const input = [...titles(3, 1, 2), { startsAtSceneIndex: 2, title: "doublon" }, { startsAtSceneIndex: 9, title: "fantôme" }];
    const result = buildChapters(scenes(30, 30, 30), input);
    expect(result.chapters.map((c) => c.title)).toEqual(["T1", "T2", "T3"]);
  });

  it("fusionne un chapitre trop court au milieu avec le précédent", () => {
    const result = buildChapters(scenes(30, 5, 30, 30), titles(1, 2, 3, 4));
    expect(result.chapters).toEqual([
      { timestamp: "00:00", title: "T1" },
      { timestamp: "00:35", title: "T3" },
      { timestamp: "01:05", title: "T4" },
    ]);
  });

  it("fait absorber le chapitre suivant par un premier chapitre trop court", () => {
    const result = buildChapters(scenes(5, 30, 30, 30), titles(1, 2, 3, 4));
    expect(result.chapters).toEqual([
      { timestamp: "00:00", title: "T1" },
      { timestamp: "00:35", title: "T3" },
      { timestamp: "01:05", title: "T4" },
    ]);
  });

  it("fusionne un dernier chapitre trop court avec le précédent", () => {
    const result = buildChapters(scenes(30, 30, 30, 5), titles(1, 2, 3, 4));
    expect(result.chapters.map((c) => c.title)).toEqual(["T1", "T2", "T3"]);
  });

  it("enchaîne les fusions jusqu'à ce que chaque chapitre dure au moins 10 s", () => {
    const result = buildChapters(scenes(30, 4, 4, 4, 30, 30), titles(1, 2, 3, 4, 5, 6));
    expect(result.chapters).toEqual([
      { timestamp: "00:00", title: "T1" },
      { timestamp: "00:42", title: "T5" },
      { timestamp: "01:12", title: "T6" },
    ]);
  });

  it("échoue s'il reste moins de 3 chapitres après fusion", () => {
    expect(buildChapters(scenes(30, 30, 5), titles(1, 2, 3))).toEqual({ ok: false, reason: "TOO_FEW_CHAPTERS", chapters: [] });
  });

  it("échoue sans aucun titre exploitable", () => {
    expect(buildChapters(scenes(30, 30, 30), titles(7, 8))).toEqual({ ok: false, reason: "TOO_FEW_CHAPTERS", chapters: [] });
  });
});
