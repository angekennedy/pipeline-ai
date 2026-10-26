import { strFromU8, unzipSync } from "fflate";
import SrtParser from "srt-parser-2";
import { describe, expect, it } from "vitest";
import type { Brief, Script, Seo, Thumbnails, Titles, Voiceover } from "@/lib/ai/schemas";
import { aiDisclosure, exportBaseName, exportBundle, pipelineToJson, pipelineToMarkdown, pipelineToSpeech, pipelineToSrt, pipelineToZip } from "@/lib/export/document";
import { scriptSpokenText, spokenText, voiceoverSpokenText } from "@/lib/export/spoken";
import { MAX_LINE, MAX_LINES, scriptCues, scriptToSrt, srtTimestamp } from "@/lib/export/srt";
import { emptyPipelineView, type PipelineView } from "@/lib/pipeline/view";
import { tEn, tFr } from "../../fixtures/i18n";
import { validBrief, validScript, validSeo, validThumbnails, validTitles, validVoiceover } from "../../fixtures/assets";

const script = validScript as Script;
const voiceover = {
  ...(validVoiceover as Voiceover),
  segments: script.scenes.map((scene, i) => ({
    ...(validVoiceover as Voiceover).segments[0]!,
    sceneIndex: scene.index,
    text: i === 0 ? "Il y a plus de quatre mille ans… [pause:600ms] un bloc impossible." : `${scene.narration} [pause:400ms] Et ensuite ?`,
  })),
} satisfies Voiceover;

function view(overrides: Partial<Record<"script" | "titles" | "seo" | "voiceover" | "thumbnails", unknown>> = {}): PipelineView {
  const base = emptyPipelineView({ id: "4d1f7c3e-2b6a-4f8e-9c0d-1a2b3c4d5e6f", brief: validBrief as Brief, tier: "standard", createdAt: "2026-10-26T08:00:00.000Z" });
  const content = { script, titles: validTitles as Titles, seo: validSeo as Seo, voiceover, thumbnails: validThumbnails as Thumbnails, ...overrides };
  for (const [type, value] of Object.entries(content)) {
    const key = type as keyof typeof content;
    base.assets[key] = { ...base.assets[key], status: value ? "ready" : "failed", content: value as never };
  }
  return { ...base, status: "completed" };
}

// Une voix de synthèse lit tout ce qu'on lui donne : seuls des mots et de la ponctuation.
const SPEAKABLE = /^[\p{L}\p{N}\s.,;:!?…'’"«»()\-–—%€$°]*$/u;

describe("texte pour la voix de synthèse (ElevenLabs)", () => {
  it("remplace les pauses par des points de suspension et retire toute balise", () => {
    expect(spokenText("Il y a quatre mille ans… [pause:600ms] un bloc impossible.")).toBe("Il y a quatre mille ans… un bloc impossible.");
    expect(spokenText('Une rampe [pause:1200ms]. **Cachée** <break time="1s"/> [note] dans # la pierre')).toBe("Une rampe… Cachée dans la pierre");
  });

  it("se colle tel quel : un paragraphe par segment, sans étiquette ni balise", () => {
    const text = voiceoverSpokenText(voiceover);
    expect(text.split("\n\n")).toHaveLength(script.scenes.length);
    expect(text).toMatch(SPEAKABLE);
    // Aucune des étiquettes du texte d'indications (voiceoverToText), ni balise.
    expect(text).not.toMatch(/Pause après|Mots appuyés|Prononciation :|Indications :|Voix :|· rythme|\[|\]|<|>|\bms\b/);
    expect(text.startsWith("Il y a plus de quatre mille ans… un bloc impossible.")).toBe(true);
  });

  it("reprend la narration du script quand la voix off manque", () => {
    expect(scriptSpokenText(script)).toBe(script.scenes.map((scene) => spokenText(scene.narration)).join("\n\n"));
    expect(pipelineToSpeech(view({ voiceover: null }))).toBe(`${scriptSpokenText(script)}\n`);
    expect(pipelineToSpeech(view({ script: null, voiceover: null }))).toBeNull();
  });
});

describe("sous-titres SRT", () => {
  const srt = scriptToSrt(script, voiceover);
  const parsed = new SrtParser().fromSrt(srt);
  const totalMs = script.scenes.reduce((sum, scene) => sum + scene.estimatedSeconds * 1000, 0);

  it("est lu sans erreur par un parseur SRT, numéroté de 1 à n", () => {
    expect(parsed.length).toBeGreaterThan(script.scenes.length);
    expect(parsed.map((cue) => cue.id)).toEqual(parsed.map((_, i) => String(i + 1)));
    expect(parsed[0]!.startSeconds).toBe(0);
    expect(parsed.at(-1)!.endSeconds).toBe(totalMs / 1000);
  });

  it("respecte le format strict : blocs séparés par une ligne vide, horodatage HH:MM:SS,mmm, CRLF", () => {
    const blocks = srt.trimEnd().split("\r\n\r\n");
    expect(blocks).toHaveLength(parsed.length);
    for (const [i, block] of blocks.entries()) {
      const [id, timing, ...text] = block.split("\r\n");
      expect(id).toBe(String(i + 1));
      expect(timing).toMatch(/^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$/);
      expect(text.length).toBeGreaterThanOrEqual(1);
      expect(text.length).toBeLessThanOrEqual(MAX_LINES);
      for (const line of text) expect(line.length <= MAX_LINE || !line.includes(" "), line).toBe(true);
    }
    expect(srt.replace(/\r\n/g, "")).not.toMatch(/\n/); // aucune fin de ligne LF seule
  });

  it("enchaîne les sous-titres sans chevauchement, chaque scène à sa place", () => {
    for (const [i, cue] of parsed.entries()) {
      expect(cue.endSeconds).toBeGreaterThan(cue.startSeconds);
      if (i > 0) expect(cue.startSeconds).toBeGreaterThanOrEqual(parsed[i - 1]!.endSeconds);
    }
    // Chaque début de scène est aussi le début d'un sous-titre.
    let start = 0;
    for (const scene of script.scenes) {
      expect(parsed.some((cue) => Math.abs(cue.startSeconds - start / 1000) < 0.001)).toBe(true);
      start += scene.estimatedSeconds * 1000;
    }
  });

  it("contient tout le texte prononcé, dans l'ordre, sans les pauses", () => {
    const words = (text: string) => text.split(/\s+/).filter(Boolean);
    expect(words(parsed.map((cue) => cue.text.replace(/\n/g, " ")).join(" "))).toEqual(words(voiceoverSpokenText(voiceover)));
    expect(srt).not.toContain("[pause");
  });

  it("formate l'horodatage au-delà d'une heure, à la milliseconde", () => {
    expect(srtTimestamp(0)).toBe("00:00:00,000");
    expect(srtTimestamp(3_661_001)).toBe("01:01:01,001");
    expect(srtTimestamp(59_999)).toBe("00:00:59,999");
  });

  it("coupe une longue phrase en sous-titres de deux lignes, entre les mots", () => {
    const narration = `${Array.from({ length: 60 }, (_, i) => `mot${i}`).join(" ")}.`;
    const long = { ...script, scenes: [{ ...script.scenes[0]!, narration, estimatedSeconds: 30 }] };
    const cues = scriptCues(long, null);
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) for (const line of cue.lines) expect(line.length).toBeLessThanOrEqual(MAX_LINE);
    expect(cues.at(-1)!.endMs).toBe(30_000);
  });

  it("n'existe pas sans script", () => {
    expect(pipelineToSrt(view({ script: null }))).toBeNull();
  });
});

describe("document, données et archive", () => {
  it("Markdown : rappel de déclaration en tête, puis chaque asset prêt", () => {
    const md = pipelineToMarkdown(view(), tFr);
    expect(md.startsWith(`# ${validBrief.topic}\n`)).toBe(true);
    expect(md).toContain("> Contenu généré avec l'aide de l'IA");
    expect(md).toContain("« Contenu modifié ou synthétique »");
    expect(md.match(/^## .+$/gm)).toEqual(["## Titres", "## Script", "## Description YouTube", "## Tags", "## Voix off", "## Miniatures"]);
  });

  it("en anglais : rappel et sections traduits", () => {
    const md = pipelineToMarkdown(view(), tEn);
    expect(md).toContain(`> ${tEn("Export.disclosure.title")}`);
    expect(md.match(/^## .+$/gm)).toEqual(["## Titles", "## Script", "## YouTube description", "## Tags", "## Voiceover", "## Thumbnails"]);
  });

  it("omet les assets en échec", () => {
    const md = pipelineToMarkdown(view({ titles: null, thumbnails: null }), tFr);
    expect(md).not.toContain("## Titres");
    expect(md).not.toContain("## Miniatures");
    expect(JSON.parse(pipelineToJson(view({ titles: null }), tFr)).assets.titles).toBeNull();
  });

  it("JSON : brief, assets prêts et rappel, relisibles", () => {
    const data = JSON.parse(pipelineToJson(view(), tFr, new Date("2026-10-26T09:00:00Z")));
    expect(data).toMatchObject({ exportedAt: "2026-10-26T09:00:00.000Z", aiDisclosure: aiDisclosure(tFr), pipeline: { brief: validBrief, status: "completed" } });
    expect(data.assets.script).toEqual(script);
    expect(data.assets.voiceover).toEqual(voiceover);
  });

  it("ZIP : un fichier par usage et un LISEZ-MOI avec le rappel", () => {
    const files = unzipSync(pipelineToZip(view(), tFr));
    expect(Object.keys(files).sort()).toEqual(
      [
        "LISEZ-MOI.txt",
        "description-youtube.txt",
        "miniatures.txt",
        "pipeline.json",
        "pipeline.md",
        "script.txt",
        "sous-titres.srt",
        "tags.txt",
        "titres.txt",
        "voix-off-elevenlabs.txt",
        "voix-off-indications.txt",
      ].sort(),
    );
    expect(strFromU8(files["LISEZ-MOI.txt"]!)).toContain(aiDisclosure(tFr));
    expect(strFromU8(files["voix-off-elevenlabs.txt"]!)).toBe(pipelineToSpeech(view()));
    expect(new SrtParser().fromSrt(strFromU8(files["sous-titres.srt"]!)).length).toBeGreaterThan(0);
  });

  it("ZIP partiel : seulement les fichiers des assets prêts", () => {
    const names = exportBundle(view({ seo: null, voiceover: null }), tFr).map((file) => file.name);
    expect(names).not.toContain("tags.txt");
    expect(names).not.toContain("voix-off-indications.txt");
    expect(names).toContain("voix-off-elevenlabs.txt"); // narration du script
  });

  it("nomme les fichiers d'après le sujet, sans accents ni ponctuation", () => {
    expect(exportBaseName(view())).toBe("pipeline-le-mystere-de-la-construction-des-pyramides-de-gizeh");
    const odd = { ...view(), brief: { ...(validBrief as Brief), topic: "¿¡!!" } };
    expect(exportBaseName(odd)).toBe("pipeline-4d1f7c3e");
  });
});
