import type { OpenAIClient } from "@/lib/ai/openai";
import { imageCostUsdMicros, RENDER_USD_MICROS_PER_SECOND, VOICE_USD_MICROS_PER_CHARACTER } from "@/lib/ai/pricing";
import type { Brief, Script, Voiceover } from "@/lib/ai/schemas";
import { videoCredits } from "@/lib/billing/credit-rules";
import { cuesToSrt, type Cue } from "@/lib/export/srt";
import { spokenText } from "@/lib/export/spoken";
import type { ElevenLabsClient } from "@/lib/media/elevenlabs";
import type { ShotstackClient } from "@/lib/media/shotstack";
import { mediaPath, type MediaStorage } from "@/lib/media/storage";
import { IMAGE_SIZE } from "@/lib/media/thumbnail-images";
import { failureOf, MissingDependencyError } from "@/lib/pipeline/generate-asset";
import type { StepRunner } from "@/lib/pipeline/run-pipeline";
import type { PipelineStore, SourceVersions } from "@/lib/pipeline/store";
import { wordsOf, wordsToCues, type TimedWord } from "./captions";
import { VIDEO_SCHEMA_VERSION, type VideoManifest } from "./manifest";
import { planShots, sceneTimings } from "./shots";
import { buildEdit } from "./timeline";

// Vidéo MP4 complète, en étapes Inngest mémoïsées : chaque étape tient dans une invocation (5 min)
// et repousse le bail de la génération ; le rendu Shotstack, qui peut durer longtemps pour une vidéo
// d'une heure, est suivi par des pauses (`sleep`) qui ne consomment pas de concurrence. Les crédits
// suivent le cycle des autres assets : réservés à la création, capturés au commit, libérés en échec.

export type VideoStepRunner = StepRunner & { sleep: (id: string, ms: number) => Promise<void> };

export type VideoDeps = {
  store: PipelineStore;
  storage: MediaStorage;
  openai: OpenAIClient;
  voice: ElevenLabsClient;
  render: ShotstackClient;
  config: { voiceId: string; voiceModel: string; imageModel: string; sandbox: boolean };
};

// Images par lot : la limite de débit des images reste basse sur un compte récent.
const IMAGE_BATCH = 4;
// Validité des liens signés lus par Shotstack : le rendu peut attendre son tour.
const SOURCE_URL_SECONDS = 48 * 3600;
// Suivi du rendu : toutes les 30 s pendant 10 min, puis toutes les 2 min, au plus 6 h. Chaque pause et
// chaque interrogation sont des étapes : une exécution Inngest en compte au plus 1 000, et une vidéo de
// 60 min en demande déjà ≈ 330 (voix et images).
const pollDelayMs = (poll: number) => (poll <= 20 ? 30_000 : 120_000);
const MAX_POLLS = 200;

export class VideoRenderError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "VideoRenderError";
  }
}

type SceneInput = { index: number; spoken: string; narration: string; visualDirection: string; bRollKeywords: string[] };

type Started =
  | { done: string }
  | {
      done: null;
      generationId: string;
      workspaceId: string;
      brief: Pick<Brief, "style" | "tone">;
      scenes: SceneInput[];
      sourceVersions: SourceVersions;
      startedAt: number;
    };

type VoiceResult = { sceneIndex: number; path: string; wordsPath: string; duration: number; characters: number };

export async function runVideoSteps(pipelineId: string, step: VideoStepRunner, deps: VideoDeps): Promise<string> {
  const { store } = deps;
  const started = await step.run("video:start", () => start(pipelineId, store));
  if (started.done !== null) return started.done;
  const { generationId, workspaceId, scenes } = started;
  const path = (...segments: string[]) => mediaPath(workspaceId, pipelineId, "video", generationId, ...segments);

  try {
    // 1. Voix off, scène par scène (avec le texte voisin pour une intonation continue).
    const voices: VoiceResult[] = [];
    for (const [i, scene] of scenes.entries()) {
      voices.push(
        await step.run(`video:voice:${scene.index}`, () =>
          synthesize(scene, { previousText: scenes[i - 1]?.spoken, nextText: scenes[i + 1]?.spoken }, { deps, generationId, path }),
        ),
      );
    }

    // 2. Plans calés sur la durée réelle de chaque voix, puis leurs images, par lots.
    const timings = sceneTimings(voices.map((v) => ({ sceneIndex: v.sceneIndex, duration: v.duration })));
    const shots = planShots(started.brief, scenes, timings);
    const images: Array<{ path: string; costUsdMicros: number | null }> = [];
    for (let first = 0; first < shots.length; first += IMAGE_BATCH) {
      const batch = shots.slice(first, first + IMAGE_BATCH);
      images.push(
        ...(await Promise.all(batch.map((shot, i) => step.run(`video:image:${first + i + 1}`, () => drawShot(shot.prompt, path(`shot-${first + i + 1}.jpg`), { deps, generationId }))))),
      );
    }

    // 3. Sous-titres calés sur la voix, en un fichier SRT pour toute la vidéo.
    const durationSeconds = Math.max(...timings.map((t) => t.start + t.duration));
    const captionsPath = await step.run("video:captions", () => captions(voices, timings, path("captions.srt"), { deps, generationId }));

    // 4. Montage et rendu.
    const renderId = await step.run("video:submit", async () => {
      await store.touchGeneration(generationId);
      const sign = (p: string) => deps.storage.signedUrl(p, SOURCE_URL_SECONDS);
      const edit = buildEdit({
        shots: await Promise.all(shots.map(async (shot, i) => ({ start: shot.start, length: shot.length, src: await sign(images[i]!.path) }))),
        voices: await Promise.all(voices.map(async (voice, i) => ({ start: timings[i]!.start, duration: voice.duration, src: await sign(voice.path) }))),
        captionsSrc: await sign(captionsPath),
        durationSeconds,
      });
      return deps.render.render(edit);
    });

    let rendered: { durationSeconds: number } | null = null;
    for (let poll = 1; poll <= MAX_POLLS && !rendered; poll++) {
      await step.sleep(`video:wait:${poll}`, pollDelayMs(poll));
      rendered = await step.run(`video:poll:${poll}`, async () => {
        await store.touchGeneration(generationId);
        const state = await deps.render.status(renderId);
        if (state.status === "failed") throw new VideoRenderError(`Rendu Shotstack ${renderId} en échec : ${state.error ?? "raison inconnue"}`);
        return state.status === "done" ? { durationSeconds: state.durationSeconds ?? durationSeconds } : null;
      });
    }
    if (!rendered) throw new VideoRenderError(`Rendu Shotstack ${renderId} toujours en cours après 6 h`);
    const final = rendered;

    // 5. Version de l'asset, avec l'URL permanente du MP4 : capture des crédits dans la même transaction.
    return await step.run("video:commit", async () => {
      // L'asset hébergé apparaît quelques secondes après la fin du rendu : l'étape est relancée en attendant.
      const url = await deps.render.hostedUrl(renderId);
      if (!url) throw new Error(`MP4 du rendu ${renderId} pas encore hébergé`);
      const manifest: VideoManifest = {
        url,
        renderId,
        durationSeconds: final.durationSeconds,
        captionsPath,
        voice: voices.map((voice, i) => ({ sceneIndex: voice.sceneIndex, path: voice.path, start: timings[i]!.start, duration: voice.duration })),
        shots: shots.map((shot, i) => ({ sceneIndex: shot.sceneIndex, start: shot.start, length: shot.length, imagePath: images[i]!.path, prompt: shot.prompt })),
        sandbox: deps.config.sandbox,
      };
      const imageCosts = images.map((image) => image.costUsdMicros);
      const characters = voices.reduce((sum, voice) => sum + voice.characters, 0);
      const costUsdMicros = imageCosts.some((cost) => cost === null)
        ? null
        : imageCosts.reduce<number>((sum, cost) => sum + cost!, 0) +
          characters * VOICE_USD_MICROS_PER_CHARACTER +
          Math.round(final.durationSeconds * RENDER_USD_MICROS_PER_SECOND);
      return store.commitAssetVersion({
        pipelineId,
        assetType: "video",
        content: manifest,
        schemaVersion: VIDEO_SCHEMA_VERSION,
        source: "ai",
        sourceVersions: started.sourceVersions,
        restoredFrom: null,
        createdBy: null,
        generation: {
          id: generationId,
          telemetry: {
            model: `${deps.config.imageModel} + ${deps.config.voiceModel} + shotstack`,
            promptVersion: VIDEO_SCHEMA_VERSION,
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
            costUsdMicros,
            latencyMs: Date.now() - started.startedAt,
            repairs: 0,
            attempts: images.length + voices.length + 1,
          },
        },
      });
    });
  } catch (error) {
    // Échec définitif d'une étape (retries épuisés) : la génération passe en échec, la réservation
    // de la vidéo est libérée à la finalisation du pipeline.
    await step.run("video:fail", () => store.markFailed(generationId, failureOf(error)));
    throw error;
  }
}

async function start(pipelineId: string, store: PipelineStore): Promise<Started> {
  const pipeline = await store.getPipeline(pipelineId);
  const generation = await store.upsertGeneration({
    pipelineId,
    assetType: "video",
    idempotencyKey: `pipe:${pipelineId}:video`,
    credits: videoCredits(pipeline.brief),
  });
  if (generation.status === "succeeded" && generation.versionId) return { done: generation.versionId };

  const [script, voiceover] = await Promise.all([store.getCurrentVersion(pipelineId, "script"), store.getCurrentVersion(pipelineId, "voiceover")]);
  if (!script) throw new MissingDependencyError(["script"]);
  await store.markRunning(generation.id, generation.attempt + 1);

  // Texte lu : le segment de voix off de la scène (indications de lecture retirées), à défaut sa narration.
  const segments = new Map((voiceover?.content as Voiceover | undefined)?.segments.map((s) => [s.sceneIndex, s.text]) ?? []);
  const scenes = (script.content as Script).scenes.map((scene) => ({
    index: scene.index,
    spoken: spokenText(segments.get(scene.index) ?? scene.narration),
    narration: scene.narration,
    visualDirection: scene.visualDirection,
    bRollKeywords: scene.bRollKeywords,
  }));
  return {
    done: null,
    generationId: generation.id,
    workspaceId: pipeline.workspaceId,
    brief: { style: pipeline.brief.style, tone: pipeline.brief.tone },
    scenes,
    sourceVersions: { script: script.restoredFrom ?? script.id, ...(voiceover && { voiceover: voiceover.restoredFrom ?? voiceover.id }) },
    startedAt: Date.now(),
  };
}

type StepContext = { deps: VideoDeps; generationId: string };

async function synthesize(
  scene: SceneInput,
  context: { previousText?: string; nextText?: string },
  { deps, generationId, path }: StepContext & { path: (...segments: string[]) => string },
): Promise<VoiceResult> {
  await deps.store.touchGeneration(generationId);
  const speech = await deps.voice.speech({ voiceId: deps.config.voiceId, modelId: deps.config.voiceModel, text: scene.spoken, ...context });
  const audioPath = path(`voice-${scene.index}.mp3`);
  const wordsPath = path(`voice-${scene.index}.json`);
  const words = wordsOf(speech.alignment);
  await deps.storage.upload(audioPath, speech.audio, "audio/mpeg");
  await deps.storage.upload(wordsPath, new TextEncoder().encode(JSON.stringify(words)), "application/json");
  const duration = Math.max(0.5, ...speech.alignment.character_end_times_seconds);
  return { sceneIndex: scene.index, path: audioPath, wordsPath, duration, characters: scene.spoken.length };
}

async function drawShot(prompt: string, imagePath: string, { deps, generationId }: StepContext): Promise<{ path: string; costUsdMicros: number | null }> {
  await deps.store.touchGeneration(generationId);
  const image = await deps.openai.generateImage({ model: deps.config.imageModel, prompt, size: IMAGE_SIZE, quality: "high", output_format: "jpeg", output_compression: 90 });
  await deps.storage.upload(imagePath, image.bytes, "image/jpeg");
  return { path: imagePath, costUsdMicros: imageCostUsdMicros(deps.config.imageModel, image.usage) };
}

async function captions(
  voices: VoiceResult[],
  timings: Array<{ start: number }>,
  srtPath: string,
  { deps, generationId }: StepContext,
): Promise<string> {
  await deps.store.touchGeneration(generationId);
  const cues: Cue[] = [];
  for (const [i, voice] of voices.entries()) {
    const words = JSON.parse(new TextDecoder().decode(await deps.storage.download(voice.wordsPath))) as TimedWord[];
    const offsetMs = Math.round(timings[i]!.start * 1000);
    cues.push(...wordsToCues(words.map((word) => ({ ...word, startMs: word.startMs + offsetMs, endMs: word.endMs + offsetMs }))));
  }
  await deps.storage.upload(srtPath, new TextEncoder().encode(cuesToSrt(cues)), "application/x-subrip");
  return srtPath;
}
