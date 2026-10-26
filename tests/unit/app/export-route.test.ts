import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Brief, Script } from "@/lib/ai/schemas";
import { emptyPipelineView, type PipelineView } from "@/lib/pipeline/view";
import { validBrief, validScript } from "../../fixtures/assets";

// Route de téléchargement des exports : accès (session, RLS), format, en-têtes. Le contenu de chaque
// format est testé dans tests/unit/export/formats.test.ts.

const ID = "4d1f7c3e-2b6a-4f8e-9c0d-1a2b3c4d5e6f";
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
// Rate limit (tâche 4.5) : secondes à attendre renvoyées par la RPC, 0 si la demande passe.
let retryAfter = 0;
const rpc = vi.fn(async () => ({ data: retryAfter, error: null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const loadPipelineView = vi.fn(async () => view);
vi.mock("@/lib/pipeline/load-view", () => ({ loadPipelineView: (...args: unknown[]) => loadPipelineView(...(args as [])) }));

const { GET } = await import("@/app/api/pipelines/[id]/export/route");
const get = (format: string | null, id = ID) =>
  GET(new Request(`http://localhost:3000/api/pipelines/${id}/export${format ? `?format=${format}` : ""}`), { params: Promise.resolve({ id }) });

function readyView(withScript = true): PipelineView {
  const base = emptyPipelineView({ id: ID, brief: validBrief as Brief, tier: "standard", createdAt: "2026-10-26T08:00:00.000Z" });
  if (withScript) base.assets.script = { ...base.assets.script, status: "ready", content: validScript as Script };
  return { ...base, status: withScript ? "partial" : "failed" };
}

beforeEach(() => {
  vi.clearAllMocks();
  user = { id: "user-1" };
  visible = { workspace_id: "ws-1" };
  view = readyView();
  retryAfter = 0;
});

describe("GET /api/pipelines/[id]/export", () => {
  it.each([
    ["md", "text/markdown; charset=utf-8", "md"],
    ["json", "application/json; charset=utf-8", "json"],
    ["txt", "text/plain; charset=utf-8", "voix-off.txt"],
    ["srt", "application/x-subrip; charset=utf-8", "srt"],
    ["zip", "application/zip", "zip"],
  ])("format %s : fichier téléchargé, jamais mis en cache", async (format, type, extension) => {
    const response = await get(format);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(type);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="pipeline-le-mystere-de-la-construction-des-pyramides-de-gizeh.${extension}"`,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(loadPipelineView).toHaveBeenCalledWith(expect.anything(), "ws-1", ID);
  });

  it("renvoie une archive ZIP valide", async () => {
    const files = unzipSync(new Uint8Array(await (await get("zip")).arrayBuffer()));
    expect(Object.keys(files)).toContain("sous-titres.srt");
  });

  it("refuse un format inconnu ou absent", async () => {
    for (const format of ["pdf", null]) expect((await get(format)).status).toBe(400);
  });

  it("répond 401 sans session, et 404 pour un id invalide ou un pipeline hors de portée", async () => {
    expect((await get("md", "pas-un-uuid")).status).toBe(404);
    user = null;
    expect((await get("md")).status).toBe(401);
    user = { id: "user-2" };
    visible = null; // RLS : pipeline d'un autre workspace
    expect((await get("md")).status).toBe(404);
    expect(loadPipelineView).not.toHaveBeenCalled();
  });

  it("répond 409 pour la voix off ou les sous-titres d'un pipeline sans script, mais exporte le document", async () => {
    view = readyView(false);
    expect((await get("txt")).status).toBe(409);
    expect((await get("srt")).status).toBe(409);
    expect((await get("md")).status).toBe(200);
  });

  it("répond 429 avec Retry-After au-delà de 60 exports par heure, sans lire le pipeline", async () => {
    retryAfter = 840;
    const response = await get("md");
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("840");
    expect(await response.text()).toBe("Trop d'exports : réessayez dans quelques minutes.");
    expect(rpc).toHaveBeenCalledWith("rate_limit_hit", { p_buckets: ["exportUser:user-1"], p_limits: [60], p_windows: [3600] });
    expect(loadPipelineView).not.toHaveBeenCalled();
  });
});
