import { requestWithRetry } from "@/lib/http";

// Montage et rendu MP4 par Shotstack (Edit API), puis hébergement sur son CDN (Serve API) : l'URL
// du rendu brut expire au bout de 24 h, celle de l'asset hébergé reste jusqu'à sa suppression.

const BASE_URL = "https://api.shotstack.io";

export class ShotstackError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ShotstackError";
    this.retryable = status === 0 || status >= 500 || [408, 409, 429].includes(status);
  }
}

export type RenderStatus = "queued" | "fetching" | "preprocessing" | "rendering" | "generating" | "saving" | "done" | "failed";

export type RenderState = { status: RenderStatus; url: string | null; error: string | null; durationSeconds: number | null };

// Sous-ensemble de l'Edit API utilisé par le pipeline (shotstack.io/docs/api).
export type Edit = {
  timeline: { background: string; tracks: Array<{ clips: Clip[] }> };
  output: { format: "mp4"; resolution: "1080"; fps: number; quality: "verylow" | "low" | "medium" | "high" | "veryhigh" };
  callback?: string;
};

export type Clip = {
  asset:
    | { type: "image"; src: string }
    | { type: "audio"; src: string; volume?: number }
    | {
        type: "caption";
        src: string;
        font?: { family?: string; color?: string; size?: number; lineHeight?: number; stroke?: string; strokeWidth?: number };
        background?: { color?: string; opacity?: number; padding?: number; borderRadius?: number };
        margin?: { top?: number; left?: number; right?: number };
      };
  start: number;
  length: number;
  fit?: "cover" | "contain" | "crop" | "none";
  effect?: string;
  transition?: { in?: string; out?: string };
};

export class ShotstackClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;

  constructor(
    private readonly apiKey: string,
    private readonly env: "stage" | "v1",
    { fetch: fetchImpl, maxRetries = 2 }: { fetch?: typeof fetch; maxRetries?: number } = {},
  ) {
    this.fetchImpl = fetchImpl ?? ((...args) => fetch(...args));
    this.maxRetries = maxRetries;
  }

  async render(edit: Edit): Promise<string> {
    const json = (await this.call("POST", `/edit/${this.env}/render`, edit)) as { response?: { id?: string } };
    const id = json.response?.id;
    if (!id) throw new ShotstackError(500, "Réponse de rendu Shotstack sans identifiant");
    return id;
  }

  async status(renderId: string): Promise<RenderState> {
    const json = (await this.call("GET", `/edit/${this.env}/render/${encodeURIComponent(renderId)}?data=false`)) as {
      response?: { status?: RenderStatus; url?: string | null; error?: string | null; duration?: number | null };
    };
    const response = json.response;
    if (!response?.status) throw new ShotstackError(500, `État du rendu ${renderId} illisible`);
    return { status: response.status, url: response.url ?? null, error: response.error ?? null, durationSeconds: response.duration ?? null };
  }

  // URL permanente du MP4 sur le CDN de Shotstack, null tant que l'asset n'est pas prêt.
  async hostedUrl(renderId: string): Promise<string | null> {
    const json = (await this.call("GET", `/serve/${this.env}/assets/render/${encodeURIComponent(renderId)}`)) as {
      data?: Array<{ attributes?: { url?: string; status?: string; filename?: string } }>;
    };
    const video = json.data?.find((asset) => asset.attributes?.status === "ready" && asset.attributes.filename?.endsWith(".mp4"));
    return video?.attributes?.url ?? null;
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const response = await requestWithRetry(
      `${BASE_URL}${path}`,
      {
        method,
        headers: { "content-type": "application/json", "x-api-key": this.apiKey },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      },
      {
        maxRetries: this.maxRetries,
        timeout: 60_000,
        fetch: this.fetchImpl,
        toError: async (res) => new ShotstackError(res.status, `${res.status} ${await messageOf(res)}`),
        networkError: (error) => new ShotstackError(0, `Requête Shotstack impossible : ${error instanceof Error ? error.message : String(error)}`),
      },
    );
    return response.json();
  }
}

async function messageOf(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const json = JSON.parse(text) as { message?: string; response?: { error?: string } };
    if (json.response?.error) return json.response.error;
    if (json.message) return json.message;
  } catch {
    // Corps non JSON : on garde le texte brut.
  }
  return text.slice(0, 200) || response.statusText;
}
