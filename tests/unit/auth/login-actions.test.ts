import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn();
const signInWithOAuth = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signInWithOtp, signInWithOAuth } }) }));

const cookieSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSet }),
  headers: async () => new Headers({ origin: "http://localhost:3000", "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
}));
let retryAfter = 0;
let invited = true; // bêta fermée (tâche 5.6) : beta_can_sign_in
const rpc = vi.fn(async (name: string) => ({ data: name === "beta_can_sign_in" ? invited : retryAfter, error: null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const { sendMagicLink, signInWithGoogle } = await import("@/app/(auth)/login/actions");
const initial = { status: "idle" as const, email: "" };
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  retryAfter = 0;
  invited = true;
});

describe("sendMagicLink", () => {
  it("envoie le lien, inscription comprise, et garde la destination en cookie", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    expect(await sendMagicLink(initial, form({ email: " a@test.local ", next: "/pipelines/new" }))).toEqual({ status: "sent", email: "a@test.local" });
    expect(signInWithOtp).toHaveBeenCalledWith({ email: "a@test.local", options: { shouldCreateUser: true } });
    expect(cookieSet).toHaveBeenCalledWith("auth_next", "/pipelines/new", expect.objectContaining({ httpOnly: true, sameSite: "lax", maxAge: 3600 }));
  });

  it("n'enregistre jamais une destination externe", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    await sendMagicLink(initial, form({ email: "a@test.local", next: "//evil.test" }));
    expect(cookieSet).toHaveBeenCalledWith("auth_next", "/", expect.anything());
  });

  it("refuse une adresse invalide sans appeler Supabase", async () => {
    expect(await sendMagicLink(initial, form({ email: "pas-une-adresse" }))).toMatchObject({ status: "error", error: "invalidEmail" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("limite par adresse et par IP, sans jamais les stocker en clair", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    await sendMagicLink(initial, form({ email: "A@Test.local" }));
    const [, args] = rpc.mock.calls[0] as unknown as [string, { p_buckets: string[]; p_limits: number[]; p_windows: number[] }];
    expect(args.p_limits).toEqual([5, 5]);
    expect(args.p_windows).toEqual([900, 900]);
    expect(args.p_buckets).toEqual([expect.stringMatching(/^loginEmail:[0-9a-f]{32}$/), expect.stringMatching(/^loginIp:[0-9a-f]{32}$/)]);
    expect(args.p_buckets.join()).not.toMatch(/test\.local|203\.0/);

    retryAfter = 600;
    expect(await sendMagicLink(initial, form({ email: "a@test.local" }))).toMatchObject({ status: "error", error: "rateLimited" });
    expect(signInWithOtp).toHaveBeenCalledOnce(); // pas d'envoi au-delà de la limite
  });

  it("en bêta fermée, n'envoie pas de lien à une adresse ni invitée ni inscrite", async () => {
    invited = false;
    expect(await sendMagicLink(initial, form({ email: "inconnu@test.local" }))).toMatchObject({ status: "error", error: "inviteOnly" });
    expect(rpc).toHaveBeenCalledWith("beta_can_sign_in", { p_email: "inconnu@test.local" });
    expect(signInWithOtp).not.toHaveBeenCalled();
    // La limite de fréquence passe avant : elle borne les essais d'adresses.
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["rate_limit_hit", "beta_can_sign_in"]);
  });

  it("refuse une adresse jetable sans rien compter ni envoyer", async () => {
    expect(await sendMagicLink(initial, form({ email: "bot@YopMail.com" }))).toMatchObject({ status: "error", error: "disposableEmail" });
    expect(rpc).not.toHaveBeenCalled();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("explique une limite de fréquence de Supabase", async () => {
    signInWithOtp.mockResolvedValue({ error: { status: 429, message: "rate limit" } });
    expect(await sendMagicLink(initial, form({ email: "a@test.local" }))).toMatchObject({ status: "error", error: "rateLimited" });
  });
});

describe("signInWithGoogle", () => {
  it("part vers Google avec un retour sur /auth/callback de ce site", async () => {
    signInWithOAuth.mockResolvedValue({ data: { url: "https://accounts.google.test/auth" }, error: null });
    await expect(signInWithGoogle(form({ next: "/w/demo" }))).rejects.toThrow("NEXT_REDIRECT https://accounts.google.test/auth");
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: "http://localhost:3000/auth/callback" } });
  });

  it("revient sur /login avec une erreur si le fournisseur refuse", async () => {
    signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: "provider disabled" } });
    await expect(signInWithGoogle(form({}))).rejects.toThrow("NEXT_REDIRECT /login?error=google");
  });
});
