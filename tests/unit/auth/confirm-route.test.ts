import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp, exchangeCodeForSession } }) }));
let nextCookie: string | undefined;
const cookieDelete = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (nextCookie ? { value: nextCookie } : undefined), delete: cookieDelete }) }));

// after() n'existe que pendant une vraie requête : ici, le rappel s'exécute tout de suite.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (callback: () => unknown) => callback() }));
const track = vi.fn();
vi.mock("@/lib/analytics/posthog", async (original) => ({
  ...(await original<typeof import("@/lib/analytics/posthog")>()),
  track: (...args: unknown[]) => track(...args),
}));
const justNow = () => new Date(Date.now() - 60_000).toISOString();
const longAgo = "2026-01-01T00:00:00.000Z";

const confirm = (await import("@/app/auth/confirm/route")).GET;
const callback = (await import("@/app/auth/callback/route")).GET;
const get = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));

beforeEach(() => {
  vi.clearAllMocks();
  nextCookie = "/pipelines/new";
});

describe("/auth/confirm", () => {
  it("ouvre la session et renvoie vers la page demandée, une seule fois", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "user-1", created_at: longAgo } }, error: null });
    const response = await confirm(get("/auth/confirm?token_hash=abc&type=email"));
    expect(verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "abc" });
    expect(response.headers.get("location")).toBe("http://localhost:3000/pipelines/new");
    expect(cookieDelete).toHaveBeenCalledWith("auth_next");
    expect(track).not.toHaveBeenCalled(); // reconnexion d'un compte existant
  });

  it("compte une inscription au premier retour d'un compte tout juste créé", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "user-1", created_at: justNow() } }, error: null });
    await confirm(get("/auth/confirm?token_hash=abc&type=email"));
    expect(track).toHaveBeenCalledWith("user-1", { name: "signed_up", properties: { method: "email" } }, "user-1");
  });

  it("renvoie vers /login avec une erreur pour un lien expiré, un type inattendu ou un jeton absent", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    for (const path of ["/auth/confirm?token_hash=abc&type=email", "/auth/confirm?token_hash=abc&type=recovery", "/auth/confirm?type=email"]) {
      expect((await confirm(get(path))).headers.get("location"), path).toBe("http://localhost:3000/login?error=lien");
    }
    expect(verifyOtp).toHaveBeenCalledTimes(1); // seul le premier lien est soumis à Supabase
  });

  it("ignore une destination externe glissée dans le cookie", async () => {
    nextCookie = "https://evil.test";
    verifyOtp.mockResolvedValue({ data: { user: null }, error: null });
    expect((await confirm(get("/auth/confirm?token_hash=abc&type=email"))).headers.get("location")).toBe("http://localhost:3000/");
  });
});

describe("/auth/callback", () => {
  it("échange le code Google contre une session, et compte une inscription Google", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "user-2", created_at: justNow() } }, error: null });
    expect((await callback(get("/auth/callback?code=xyz"))).headers.get("location")).toBe("http://localhost:3000/pipelines/new");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("xyz");
    expect(track).toHaveBeenCalledWith("user-2", { name: "signed_up", properties: { method: "google" } }, "user-2");
  });

  it("renvoie vers /login en cas de refus ou d'échange impossible", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "bad code" } });
    expect((await callback(get("/auth/callback?code=xyz"))).headers.get("location")).toBe("http://localhost:3000/login?error=google");
    expect((await callback(get("/auth/callback?error=access_denied"))).headers.get("location")).toBe("http://localhost:3000/login?error=google");
  });
});
