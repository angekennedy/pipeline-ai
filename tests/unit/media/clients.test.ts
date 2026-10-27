import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { OpenAIClient, OpenAIError } from "@/lib/ai/openai";
import { ElevenLabsClient, ElevenLabsError, MAX_SPEECH_CHARACTERS } from "@/lib/media/elevenlabs";
import { ShotstackClient, ShotstackError, type Edit } from "@/lib/media/shotstack";
import { server } from "../../mocks/server";

const b64 = (text: string) => Buffer.from(text).toString("base64");

describe("ElevenLabsClient", () => {
  const client = new ElevenLabsClient("xi-test", { maxRetries: 0 });
  const alignment = { characters: ["O", "k"], character_start_times_seconds: [0, 0.1], character_end_times_seconds: [0.1, 0.2] };

  it("demande la voix avec son minutage et renvoie l'audio décodé", async () => {
    let request: Request | null = null;
    server.use(
      http.post("https://api.elevenlabs.io/v1/text-to-speech/:voice/with-timestamps", async ({ request: req }) => {
        request = req.clone();
        return HttpResponse.json({ audio_base64: b64("mp3-bytes"), alignment });
      }),
    );
    const speech = await client.speech({ voiceId: "voice1", modelId: "eleven_multilingual_v2", text: "Ok", previousText: "Avant" });
    expect(new TextDecoder().decode(speech.audio)).toBe("mp3-bytes");
    expect(speech.alignment).toEqual(alignment);
    expect(request!.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice1/with-timestamps?output_format=mp3_44100_128");
    expect(request!.headers.get("xi-api-key")).toBe("xi-test");
    expect(await request!.json()).toEqual({ text: "Ok", model_id: "eleven_multilingual_v2", previous_text: "Avant" });
  });

  it("signale une clé refusée comme définitive, une surcharge comme passagère", async () => {
    server.use(http.post("https://api.elevenlabs.io/v1/text-to-speech/:voice/with-timestamps", () => HttpResponse.json({ detail: { message: "Invalid API key" } }, { status: 401 })));
    const refused = await client.speech({ voiceId: "v", modelId: "m", text: "Ok" }).catch((e) => e);
    expect(refused).toBeInstanceOf(ElevenLabsError);
    expect(refused).toMatchObject({ status: 401, retryable: false, message: "401 Invalid API key" });

    server.use(http.post("https://api.elevenlabs.io/v1/text-to-speech/:voice/with-timestamps", () => HttpResponse.json({ detail: "busy" }, { status: 503 })));
    expect(await client.speech({ voiceId: "v", modelId: "m", text: "Ok" }).catch((e) => e)).toMatchObject({ status: 503, retryable: true });
  });

  it("refuse un texte trop long pour une requête, sans l'envoyer", async () => {
    await expect(client.speech({ voiceId: "v", modelId: "m", text: "a".repeat(MAX_SPEECH_CHARACTERS + 1) })).rejects.toMatchObject({ retryable: false });
  });
});

describe("ShotstackClient", () => {
  const client = new ShotstackClient("ss-test", "stage", { maxRetries: 0 });
  const edit: Edit = { timeline: { background: "#000000", tracks: [] }, output: { format: "mp4", resolution: "1080", fps: 25, quality: "high" } };

  it("envoie le montage au bac à sable et renvoie l'identifiant du rendu", async () => {
    let request: Request | null = null;
    server.use(
      http.post("https://api.shotstack.io/edit/stage/render", async ({ request: req }) => {
        request = req.clone();
        return HttpResponse.json({ success: true, response: { id: "r-1", message: "Created" } }, { status: 201 });
      }),
    );
    expect(await client.render(edit)).toBe("r-1");
    expect(request!.headers.get("x-api-key")).toBe("ss-test");
    expect(await request!.json()).toEqual(edit);
  });

  it("lit l'état du rendu et l'URL hébergée du MP4", async () => {
    server.use(
      http.get("https://api.shotstack.io/edit/stage/render/r-1", () => HttpResponse.json({ response: { status: "done", url: "https://tmp/r-1.mp4", duration: 61.2 } })),
      http.get("https://api.shotstack.io/serve/stage/assets/render/r-1", () =>
        HttpResponse.json({
          data: [
            { attributes: { status: "ready", filename: "r-1.jpg", url: "https://cdn/r-1.jpg" } },
            { attributes: { status: "ready", filename: "r-1.mp4", url: "https://cdn/r-1.mp4" } },
          ],
        }),
      ),
    );
    expect(await client.status("r-1")).toEqual({ status: "done", url: "https://tmp/r-1.mp4", error: null, durationSeconds: 61.2 });
    expect(await client.hostedUrl("r-1")).toBe("https://cdn/r-1.mp4");
  });

  it("renvoie null tant que le MP4 n'est pas importé sur le CDN, et l'erreur de l'API sinon", async () => {
    server.use(http.get("https://api.shotstack.io/serve/stage/assets/render/r-2", () => HttpResponse.json({ data: [{ attributes: { status: "importing", filename: "r-2.mp4", url: "x" } }] })));
    expect(await client.hostedUrl("r-2")).toBeNull();

    server.use(http.post("https://api.shotstack.io/edit/stage/render", () => HttpResponse.json({ message: "Forbidden" }, { status: 403 })));
    const error = await client.render(edit).catch((e) => e);
    expect(error).toBeInstanceOf(ShotstackError);
    expect(error).toMatchObject({ status: 403, retryable: false, message: "403 Forbidden" });
  });
});

describe("OpenAIClient.generateImage", () => {
  const client = new OpenAIClient({ apiKey: "test-key", maxRetries: 0 });

  it("demande une seule image et renvoie ses octets et l'usage", async () => {
    let body: unknown = null;
    server.use(
      http.post("https://api.openai.com/v1/images/generations", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: [{ b64_json: b64("jpeg-bytes") }], usage: { input_tokens: 50, output_tokens: 6000 } });
      }),
    );
    const image = await client.generateImage({ model: "gpt-image-2", prompt: "Un ciel", size: "1536x864", quality: "high", output_format: "jpeg" });
    expect(new TextDecoder().decode(image.bytes)).toBe("jpeg-bytes");
    expect(image.usage).toEqual({ input_tokens: 50, output_tokens: 6000 });
    expect(body).toEqual({ model: "gpt-image-2", prompt: "Un ciel", size: "1536x864", quality: "high", output_format: "jpeg", n: 1 });
  });

  it("refuse une réponse sans image", async () => {
    server.use(http.post("https://api.openai.com/v1/images/generations", () => HttpResponse.json({ data: [] })));
    await expect(client.generateImage({ model: "gpt-image-2", prompt: "x", size: "1536x864", quality: "high", output_format: "jpeg" })).rejects.toBeInstanceOf(OpenAIError);
  });
});
