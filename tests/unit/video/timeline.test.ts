import { describe, expect, it } from "vitest";
import { buildEdit } from "@/lib/video/timeline";

describe("montage Shotstack", () => {
  const edit = buildEdit({
    shots: [
      { start: 0, length: 15, src: "https://s/1.jpg" },
      { start: 15, length: 15, src: "https://s/2.jpg" },
      { start: 30, length: 10, src: "https://s/3.jpg" },
    ],
    voices: [
      { start: 0, duration: 20, src: "https://s/v1.mp3" },
      { start: 20.4, duration: 19.6, src: "https://s/v2.mp3" },
    ],
    captionsSrc: "https://s/captions.srt",
    durationSeconds: 40,
  });

  it("sort un MP4 en 1080p, haute qualité", () => {
    expect(edit.output).toEqual({ format: "mp4", resolution: "1080", fps: 25, quality: "high" });
  });

  it("superpose images, voix puis sous-titres (la dernière piste au-dessus)", () => {
    expect(edit.timeline.tracks.map((track) => track.clips[0]!.asset.type)).toEqual(["image", "audio", "caption"]);
  });

  it("alterne les zooms lents et fond les images entre elles", () => {
    const [first, second, last] = edit.timeline.tracks[0]!.clips;
    expect([first!.effect, second!.effect, last!.effect]).toEqual(["zoomInSlow", "zoomOutSlow", "zoomInSlow"]);
    expect(first).toMatchObject({ fit: "cover", length: 15.5, transition: { in: "fade" } });
    expect(second!.transition).toEqual({ in: "fadeSlow" });
    expect(last).toMatchObject({ length: 10, transition: { in: "fadeSlow", out: "fade" } });
  });

  it("place chaque voix à son début et les sous-titres sur toute la durée", () => {
    expect(edit.timeline.tracks[1]!.clips.map((clip) => [clip.start, clip.length])).toEqual([[0, 20], [20.4, 19.6]]);
    expect(edit.timeline.tracks[2]!.clips[0]).toMatchObject({ asset: { type: "caption", src: "https://s/captions.srt" }, start: 0, length: 40 });
  });
});
