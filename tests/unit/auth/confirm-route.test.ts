import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp, exchangeCodeForSession } }) }));
let nextCookie: string | undefined;
const cookieDelete = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (nextCookie ? { value: nextCookie } : undefined), delete: cookieDelete }) }));

const confirm = (await import("@/app/auth/confirm/route")).GET;
const callback = (await import("@/app/auth/callback/route")).GET;
const get = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));

beforeEach(() => {
  vi.clearAllMocks();
  nextCookie = "/pipelines/new";
});

describe("/auth/confirm", () => {
  it("ouvre la session et renvoie vers la page demandée, une seule fois", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const response = await confirm(get("/auth/confirm?token_hash=abc&type=email"));
    expect(verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "abc" });
    expect(response.headers.get("location")).toBe("http://localhost:3000/pipelines/new");
    expect(cookieDelete).toHaveBeenCalledWith("auth_next");
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
    verifyOtp.mockResolvedValue({ error: null });
    expect((await confirm(get("/auth/confirm?token_hash=abc&type=email"))).headers.get("location")).toBe("http://localhost:3000/");
  });
});

describe("/auth/callback", () => {
  it("échange le code Google contre une session", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    expect((await callback(get("/auth/callback?code=xyz"))).headers.get("location")).toBe("http://localhost:3000/pipelines/new");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("xyz");
  });

  it("renvoie vers /login en cas de refus ou d'échange impossible", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "bad code" } });
    expect((await callback(get("/auth/callback?code=xyz"))).headers.get("location")).toBe("http://localhost:3000/login?error=google");
    expect((await callback(get("/auth/callback?error=access_denied"))).headers.get("location")).toBe("http://localhost:3000/login?error=google");
  });
});
