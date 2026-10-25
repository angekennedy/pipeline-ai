import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Session simulée : getClaims renvoie un utilisateur ou rien, et pose un cookie rafraîchi.
let claims: { sub: string } | null = null;
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, { cookies }: { cookies: { setAll: (c: unknown[], h: Record<string, string>) => void } }) => ({
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
