import { describe, expect, it } from "vitest";
import { videoMinutesOf } from "@/lib/video/length";

const words = (n: number) => Array.from({ length: n }, () => "mot").join(" ");
const script = (...counts: number[]) => ({ scenes: counts.map((n) => ({ narration: words(n) })) }) as never;

describe("videoMinutesOf", () => {
  it("compte la narration de toutes les scènes, arrondie à la minute supérieure", () => {
    expect(videoMinutesOf(script(100, 50), "fr")).toBe(1); // 150 mots à 150 mots/min
    expect(videoMinutesOf(script(100, 51), "fr")).toBe(2);
    expect(videoMinutesOf(script(5), "fr")).toBe(1); // au moins une minute
  });
});
