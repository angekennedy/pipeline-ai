import { requestWithRetry } from "@/lib/http";

// Voix off par ElevenLabs, avec le minutage de chaque caractère (endpoint `with-timestamps`) : il
// sert à caler les sous-titres sur la voix réelle, pas sur une estimation.

const BASE_URL = "https://api.elevenlabs.io/v1";
// Limite d'une requête pour eleven_multilingual_v2 : 10 000 caractères. Une scène en compte au plus
// quelques milliers ; on refuse au-delà plutôt que de couper une phrase.
export const MAX_SPEECH_CHARACTERS = 9_500;

export class ElevenLabsError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ElevenLabsError";
    // 4xx hors 408/409/429 : clé, voix ou texte refusés, inutile de relancer l'étape.
    this.retryable = status === 0 || status >= 500 || [408, 409, 429].includes(status);
  }
}

export type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

export type Speech = { audio: Uint8Array; alignment: Alignment };

export type SpeechRequest = {
  voiceId: string;
  modelId: string;
  text: string;
  previousText?: string; // continuité de l'intonation entre deux scènes
  nextText?: string;
};

export class ElevenLabsClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;

  constructor(
    private readonly apiKey: string,
    { fetch: fetchImpl, maxRetries = 2 }: { fetch?: typeof fetch; maxRetries?: number } = {},
  ) {
    this.fetchImpl = fetchImpl ?? ((...args) => fetch(...args));
    this.maxRetries = maxRetries;
  }

  async speech({ voiceId, modelId, text, previousText, nextText }: SpeechRequest, { signal }: { signal?: AbortSignal } = {}): Promise<Speech> {
    if (text.length > MAX_SPEECH_CHARACTERS) throw new ElevenLabsError(400, `Texte trop long pour une requête (${text.length} caractères)`);
    const response = await requestWithRetry(
      `${BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "xi-api-key": this.apiKey },
        body: JSON.stringify({ text, model_id: modelId, previous_text: previousText, next_text: nextText }),
      },
      {
        maxRetries: this.maxRetries,
        // 3 tentatives tiennent dans une invocation Vercel (300 s) : au-delà, l'étape serait coupée
        // sans erreur exploitable, puis rejouée.
        timeout: 90_000,
        fetch: this.fetchImpl,
        signal,
        toError: async (res) => new ElevenLabsError(res.status, `${res.status} ${await detailOf(res)}`),
        networkError: (error) => new ElevenLabsError(0, `Requête ElevenLabs impossible : ${error instanceof Error ? error.message : String(error)}`),
      },
    );
    const json = (await response.json()) as { audio_base64?: string; alignment?: Alignment | null };
    if (!json.audio_base64 || !json.alignment) throw new ElevenLabsError(response.status, "Réponse ElevenLabs sans audio ou sans minutage");
    return { audio: new Uint8Array(Buffer.from(json.audio_base64, "base64")), alignment: json.alignment };
  }
}

async function detailOf(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const { detail } = JSON.parse(text) as { detail?: string | { message?: string; status?: string } };
    if (typeof detail === "string") return detail;
    if (detail?.message) return detail.message;
  } catch {
    // Corps non JSON : on garde le texte brut.
  }
  return text.slice(0, 200) || response.statusText;
}
