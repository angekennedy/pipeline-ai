import type { Alignment, Speech, SpeechRequest } from "@/lib/media/elevenlabs";
import type { Edit, RenderState } from "@/lib/media/shotstack";
import type { MediaStorage } from "@/lib/media/storage";

// Doublures des services de la vidéo, sans réseau : stockage en mémoire, voix au minutage régulier
// (un caractère toutes les 50 ms), rendu qui aboutit au bout de quelques interrogations.

export class MemoryMediaStorage implements MediaStorage {
  readonly files = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async upload(path: string, bytes: Uint8Array, contentType: string) {
    this.files.set(path, { bytes, contentType });
  }

  async download(path: string) {
    const file = this.files.get(path);
    if (!file) throw new Error(`Média absent : ${path}`);
    return file.bytes;
  }

  async signedUrl(path: string, expiresInSeconds: number) {
    return `https://storage.test/${path}?expires=${expiresInSeconds}`;
  }

  text(path: string) {
    return new TextDecoder().decode(this.files.get(path)?.bytes);
  }
}

export function regularAlignment(text: string, secondsPerChar = 0.05): Alignment {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * secondsPerChar),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * secondsPerChar),
  };
}

export class FakeVoice {
  readonly requests: SpeechRequest[] = [];
  async speech(request: SpeechRequest): Promise<Speech> {
    this.requests.push(request);
    return { audio: new TextEncoder().encode(`mp3:${request.text}`), alignment: regularAlignment(request.text) };
  }
}

export class FakeRender {
  readonly edits: Edit[] = [];
  polls = 0;
  constructor(
    private readonly outcome: { pollsBeforeDone?: number; fail?: string; hostedUrl?: string | null } = {},
  ) {}

  async render(edit: Edit) {
    this.edits.push(edit);
    return "render-1";
  }

  async status(): Promise<RenderState> {
    this.polls++;
    if (this.outcome.fail) return { status: "failed", url: null, error: this.outcome.fail, durationSeconds: null };
    const done = this.polls > (this.outcome.pollsBeforeDone ?? 1);
    return done ? { status: "done", url: "https://cdn.test/tmp.mp4", error: null, durationSeconds: 42 } : { status: "rendering", url: null, error: null, durationSeconds: null };
  }

  async hostedUrl() {
    return this.outcome.hostedUrl === undefined ? "https://cdn.shotstack.test/render-1.mp4" : this.outcome.hostedUrl;
  }
}

// Client d'images minimal : renvoie des octets et un usage fixe, enregistre les prompts.
export class FakeImages {
  readonly prompts: string[] = [];
  async generateImage({ prompt }: { prompt: string }) {
    this.prompts.push(prompt);
    return { bytes: new TextEncoder().encode(`jpeg:${this.prompts.length}`), usage: { input_tokens: 100, output_tokens: 6000 } };
  }
}
