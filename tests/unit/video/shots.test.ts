import { describe, expect, it } from "vitest";
import { planShots, SCENE_GAP_SECONDS, sceneTimings, shotPrompt } from "@/lib/video/shots";

const brief = { style: "documentary", tone: "mysterious" } as const;
const scene = (index: number, narration: string) => ({ index, narration, visualDirection: `Plan large de la scène ${index}`, bRollKeywords: ["pyramide", "désert"] });

describe("découpage en plans", () => {
  it("enchaîne les scènes d'après la durée de leur voix, avec un court silence entre deux", () => {
    expect(sceneTimings([{ sceneIndex: 1, duration: 10 }, { sceneIndex: 2, duration: 20 }])).toEqual([
      { sceneIndex: 1, start: 0, duration: 10 },
      { sceneIndex: 2, start: 10 + SCENE_GAP_SECONDS, duration: 20 },
    ]);
  });

  it("pose une image toutes les 15 s environ, sans trou ni recouvrement", () => {
    const scenes = [scene(1, "Une phrase. Une autre phrase."), scene(2, "Première idée. Deuxième idée. Troisième idée. Quatrième idée.")];
    const timings = sceneTimings([{ sceneIndex: 1, duration: 8 }, { sceneIndex: 2, duration: 46 }]);
    const shots = planShots(brief, scenes, timings);
    expect(shots.filter((s) => s.sceneIndex === 1)).toHaveLength(1);
    expect(shots.filter((s) => s.sceneIndex === 2)).toHaveLength(3);
    for (let i = 0; i < shots.length - 1; i++) expect(shots[i]!.start + shots[i]!.length).toBeCloseTo(shots[i + 1]!.start, 2);
    const last = shots.at(-1)!;
    expect(last.start + last.length).toBeCloseTo(timings[1]!.start + 46 + SCENE_GAP_SECONDS, 2);
  });

  it("illustre la partie de la narration du plan, sans texte ni présentateur", () => {
    const prompt = shotPrompt(brief, scene(1, ""), "La rampe cachée change tout.", 1);
    expect(prompt).toContain("documentary photograph");
    expect(prompt).toContain("mysterious mood");
    expect(prompt).toContain("Main subject: désert.");
    expect(prompt).toContain('"La rampe cachée change tout."');
    expect(prompt).toMatch(/No text.*no on-camera presenter/);
  });

  it("refuse une voix sans scène correspondante dans le script", () => {
    expect(() => planShots(brief, [scene(1, "Texte.")], sceneTimings([{ sceneIndex: 9, duration: 5 }]))).toThrow(/Scène 9/);
  });
});
