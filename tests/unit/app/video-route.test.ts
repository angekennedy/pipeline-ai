import { http, HttpResponse } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Brief } from "@/lib/ai/schemas";
import { emptyPipelineView, type PipelineView } from "@/lib/pipeline/view";
import { isShotstackUrl, type VideoManifest } from "@/lib/video/manifest";
import { validBrief } from "../../fixtures/assets";
import { server } from "../../mocks/server";

// Téléchargement du MP4 : accès (session, RLS), vidéo prête, hôte Shotstack, pièce jointe en flux.

const ID = "4d1f7c3e-2b6a-4f8e-9c0d-1a2b3c4d5e6f";
const MP4 = "https://cdn.shotstack.io/au/v1/render-1.mp4";
let user: { id: string } | null;
let visible: { workspace_id: string } | null;
let view: PipelineView | null;

vi.mock("@/lib/auth/session", () => ({ getUser: async () => user }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data: visible, error: null }) };
      return builder;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async () => ({ data: 0, error: null }) }) }));
vi.mock("@/lib/pipeline/load-view", () => ({ loadPipelineView: async () => view }));

const { GET } = await import("@/app/api/pipelines/[id]/video/route");
const get = (id = ID) => GET(new Request(`http://localhost:3000/api/pipelines/${id}/video`), { params: Promise.resolve({ id }) });

const manifest = (url = MP4): VideoManifest => ({
  url,
  renderId: "render-1",
  durationSeconds: 60,
  captionsPath: "ws/pipe/video/gen/captions.srt",
  voice: [{ sceneIndex: 1, path: "ws/pipe/video/gen/voice-1.mp3", start: 0, duration: 60 }],
  shots: [{ sceneIndex: 1, start: 0, length: 60, imagePath: "ws/pipe/video/gen/shot-1.jpg", prompt: "plan" }],
  sandbox: false,
});
const withVideo = (video?: PipelineView["video"]): PipelineView => ({
  ...emptyPipelineView({ id: ID, brief: { ...validBrief, video: true } as Brief, tier: "standard", createdAt: "2026-10-26T08:00:00.000Z" }),
  status: "completed",
  ...(video && { video }),
});

beforeEach(() => {
  user = { id: "user-1" };
  visible = { workspace_id: "ws-1" };
  view = withVideo({ status: "ready", content: manifest(), error: null });
  server.use(http.get(MP4, () => new HttpResponse("mp4-bytes", { headers: { "content-type": "video/mp4", "content-length": "9" } })));
});

describe("GET /api/pipelines/[id]/video", () => {
  it("relaie le MP4 en pièce jointe, nommée d'après le sujet", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-length")).toBe("9");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="pipeline-.+\.mp4"$/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("mp4-bytes");
  });

  it("demande une session, et répond 404 à un pipeline invisible ou à un identifiant invalide", async () => {
    user = null;
    expect((await get()).status).toBe(401);
    user = { id: "user-1" };
    visible = null;
    expect((await get()).status).toBe(404);
    expect((await get("pas-un-uuid")).status).toBe(404);
  });

  it("répond 409 tant que la vidéo n'est pas prête", async () => {
    view = withVideo({ status: "running", content: null, error: null });
    expect((await get()).status).toBe(409);
    view = withVideo();
    expect((await get()).status).toBe(409);
  });

  it("ne relaie que les hôtes de Shotstack", async () => {
    view = withVideo({ status: "ready", content: manifest("https://exemple.test/video.mp4"), error: null });
    await expect(get()).rejects.toThrow(/hôte inattendu/);
    expect(isShotstackUrl("https://cdn.shotstack.io/x.mp4")).toBe(true);
    expect(isShotstackUrl("https://shotstack-api-v1-output.s3-ap-southeast-2.amazonaws.com/x.mp4")).toBe(true);
    expect(isShotstackUrl("http://cdn.shotstack.io/x.mp4")).toBe(false);
    expect(isShotstackUrl("https://shotstack.io.evil.test/x.mp4")).toBe(false);
  });

  it("répond 502 si le CDN ne renvoie pas le fichier", async () => {
    server.use(http.get(MP4, () => new HttpResponse(null, { status: 404 })));
    expect((await get()).status).toBe(502);
  });
});
