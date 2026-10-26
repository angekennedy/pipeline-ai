import { beforeEach, describe, expect, it, vi } from "vitest";

// Bêta fermée (tâche 5.6) : logique de src/lib/beta.ts, actions de /admin et réponse NPS. Le comptage
// et les droits en base sont testés dans tests/integration/beta.test.ts.

let user: { id: string; email: string | null };
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => user }));
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url), notFound: () => notFound() }));
const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));
const cookieSet = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet }) }));

const rpc = vi.fn(async () => ({ data: null, error: null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const upsert = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => ({ upsert }) }) }));

const { npsScore, shouldAskNps, betaSettings } = await import("@/lib/beta");
const { addBetaInvite, removeBetaInvite, toggleInviteOnly } = await import("@/app/admin/actions");
const { dismissNps, submitNps } = await import("@/app/(app)/nps-actions");

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_EMAILS", "ops@pipeline.test");
  user = { id: "admin-1", email: "ops@pipeline.test" };
});

describe("NPS : calcul et éligibilité", () => {
  it("vaut % de promoteurs − % de détracteurs, arrondi, et rien sans réponse", () => {
    expect(npsScore({ responses: 10, promoters: 6, passives: 2, detractors: 2 })).toBe(40);
    expect(npsScore({ responses: 3, promoters: 0, passives: 0, detractors: 3 })).toBe(-100);
    expect(npsScore({ responses: 3, promoters: 1, passives: 2, detractors: 0 })).toBe(33);
    expect(npsScore({ responses: 0, promoters: 0, passives: 0, detractors: 0 })).toBeNull();
  });

  it("pose la question après le deuxième pipeline abouti, et plus jamais après une réponse", async () => {
    const db = (answered: boolean, count: number) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: async () => ({ count, error: null }),
        maybeSingle: async () => ({ data: answered ? { user_id: "u" } : null, error: null }),
      };
      return { from: () => builder } as never;
    };
    expect(await shouldAskNps(db(false, 1), "u")).toBe(false);
    expect(await shouldAskNps(db(false, 2), "u")).toBe(true);
    expect(await shouldAskNps(db(true, 5), "u")).toBe(false);
  });

  it("lit les réglages de la bêta, invitations comprises", async () => {
    const settings = { rpc: async () => ({ data: [{ invite_only: true, invites: [{ email: "a@test.local", note: null, invited_at: "2026-10-26T08:00:00Z" }] }], error: null }) } as never;
    expect(await betaSettings(settings)).toEqual({ inviteOnly: true, invites: [{ email: "a@test.local", note: null, invitedAt: "2026-10-26T08:00:00Z" }] });
  });
});

describe("actions de /admin", () => {
  it("répondent 404 à qui n'est pas administrateur, sans rien écrire", async () => {
    user = { id: "u", email: "user@test.local" };
    await expect(toggleInviteOnly(form({ enabled: "true" }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(addBetaInvite(form({ email: "a@test.local" }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("activent le mode bêta et ajoutent ou retirent une invitation", async () => {
    await toggleInviteOnly(form({ enabled: "true" }));
    expect(rpc).toHaveBeenCalledWith("set_beta_invite_only", { p_enabled: true });
    await expect(addBetaInvite(form({ email: " ada@test.local ", note: "Histoire" }))).rejects.toThrow("NEXT_REDIRECT /admin?invite=added");
    expect(rpc).toHaveBeenCalledWith("add_beta_invite", { p_email: "ada@test.local", p_note: "Histoire" });
    await removeBetaInvite(form({ email: "ada@test.local" }));
    expect(rpc).toHaveBeenCalledWith("remove_beta_invite", { p_email: "ada@test.local" });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("refusent une adresse invalide sans l'enregistrer", async () => {
    await expect(addBetaInvite(form({ email: "pas-une-adresse" }))).rejects.toThrow("NEXT_REDIRECT /admin?invite=invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("réponse NPS", () => {
  it("enregistre la note et le commentaire de l'utilisateur, une réponse modifiable", async () => {
    user = { id: "user-1", email: "a@test.local" };
    expect(await submitNps({}, form({ score: "9", comment: "  Très utile " }))).toEqual({ sent: true });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1", score: 9, comment: "Très utile" }), { onConflict: "user_id" });
  });

  it("demande une note de 0 à 10", async () => {
    expect(await submitNps({}, form({ comment: "sans note" }))).toEqual({ error: "score" });
    expect(await submitNps({}, form({ score: "11" }))).toEqual({ error: "score" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("« plus tard » reporte la question de 30 jours", async () => {
    await dismissNps();
    expect(cookieSet).toHaveBeenCalledWith("nps_dismissed", "1", expect.objectContaining({ maxAge: 30 * 24 * 3600, httpOnly: true }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
