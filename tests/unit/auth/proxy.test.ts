import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Session simulée : getClaims renvoie un utilisateur ou rien, et pose un cookie rafraîchi.
let claims: { sub: string; email?: string } | null = null;
// Lignes visibles sous RLS par l'utilisateur simulé : workspaces par slug, pipelines et presets par id
// (valeur : leur workspace).
type Visible = { workspaces: Record<string, string>; pipelines: Record<string, string>; channels: Record<string, string> };
let visible: Visible = { workspaces: {}, pipelines: {}, channels: {} };
const query = (table: keyof Visible) => {
  const filters: Record<string, string> = {};
  const builder = {
    select: () => builder,
    eq: (column: string, value: string) => ((filters[column] = value), builder),
    maybeSingle: async () => {
      if (table === "workspaces") {
        const id = visible.workspaces[filters.slug!];
        return { data: id ? { id } : null, error: null };
      }
      const ws = visible[table][filters.id!];
      return { data: ws && ws === filters.workspace_id ? { id: filters.id } : null, error: null };
    },
  };
  return builder;
};
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, { cookies }: { cookies: { setAll: (c: unknown[], h: Record<string, string>) => void } }) => ({
    from: query,
    auth: {
      getClaims: async () => {
        cookies.setAll([{ name: "sb-token", value: "rafraichi", options: { path: "/" } }], { "cache-control": "private, no-store" });
        return { data: claims ? { claims } : null, error: null };
      },
    },
  }),
}));

const { updateSession } = await import("@/lib/supabase/proxy");
const request = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));

beforeEach(() => {
  claims = null;
  visible = { workspaces: {}, pipelines: {}, channels: {} };
});

describe("proxy : filtre de session", () => {
  it("renvoie une route de l'application vers /login sans session, en gardant la destination", async () => {
    const response = await updateSession(request("/pipelines/new?from=nav"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fpipelines%2Fnew%3Ffrom%3Dnav");
    expect(response.cookies.get("sb-token")?.value).toBe("rafraichi");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("laisse passer les pages publiques sans session", async () => {
    for (const path of ["/", "/pricing", "/login", "/pipelines/demo-completed"]) {
      expect((await updateSession(request(path))).headers.get("location"), path).toBeNull();
    }
  });

  it("laisse passer une session ouverte, et la renvoie de /login vers sa destination interne", async () => {
    claims = { sub: "user-1" };
    expect((await updateSession(request("/pipelines/new"))).headers.get("location")).toBeNull();
    expect((await updateSession(request("/login?next=/w/demo"))).headers.get("location")).toBe("http://localhost:3000/w/demo");
    expect((await updateSession(request("/login?next=https://evil.test"))).headers.get("location")).toBe("http://localhost:3000/");
  });
});

describe("proxy : portée des workspaces", () => {
  const PIPELINE = "4d1f7c3e-2b6a-4f8e-9c0d-1a2b3c4d5e6f";
  const CHANNEL = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
  beforeEach(() => {
    claims = { sub: "user-1" };
    visible = { workspaces: { "mon-espace": "ws-1" }, pipelines: { [PIPELINE]: "ws-1" }, channels: { [CHANNEL]: "ws-1" } };
  });
  const rewrittenTo = (response: Response) => response.headers.get("x-middleware-rewrite");

  it("laisse passer un workspace, un pipeline et un preset de l'utilisateur", async () => {
    for (const path of ["/w/mon-espace", "/w/mon-espace/pipelines/new", `/w/mon-espace/pipelines/${PIPELINE}`, `/w/mon-espace/channels/${CHANNEL}`]) {
      expect(rewrittenTo(await updateSession(request(path))), path).toBeNull();
    }
  });

  it("répond 404 pour un workspace hors de portée, une ressource d'un autre workspace ou un id invalide", async () => {
    visible.workspaces["autre"] = "ws-2";
    for (const path of [
      "/w/inconnu",
      "/w/inconnu/pipelines/new",
      `/w/autre/pipelines/${PIPELINE}`,
      `/w/autre/channels/${CHANNEL}`,
      `/w/mon-espace/channels/${PIPELINE}`, // un id de pipeline n'est pas un preset
      "/w/mon-espace/pipelines/pas-un-uuid",
    ]) {
      expect(rewrittenTo(await updateSession(request(path))), path).toBe("http://localhost:3000/introuvable");
    }
  });
});

describe("proxy : administration de la plateforme", () => {
  const rewrittenTo = (response: Response) => response.headers.get("x-middleware-rewrite");
  beforeEach(() => vi.stubEnv("ADMIN_EMAILS", "ops@pipeline.test, Ada@Pipeline.test"));
  afterEach(() => vi.unstubAllEnvs());

  it("ouvre /admin aux adresses listées dans ADMIN_EMAILS, sans tenir compte de la casse", async () => {
    claims = { sub: "admin-1", email: "ada@pipeline.test" };
    expect(rewrittenTo(await updateSession(request("/admin")))).toBeNull();
  });

  it("répond 404 aux autres, connectés ou non, sans renvoyer vers la connexion", async () => {
    for (const visitor of [null, { sub: "user-1", email: "user@test.local" }, { sub: "user-2" }]) {
      claims = visitor;
      for (const path of ["/admin", "/admin/x"]) {
        const response = await updateSession(request(path));
        expect(rewrittenTo(response), `${path} ${visitor?.email}`).toBe("http://localhost:3000/introuvable");
      }
    }
    vi.stubEnv("ADMIN_EMAILS", "");
    claims = { sub: "admin-1", email: "ada@pipeline.test" };
    expect(rewrittenTo(await updateSession(request("/admin")))).toBe("http://localhost:3000/introuvable");
  });
});
