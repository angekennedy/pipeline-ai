import { beforeEach, describe, expect, it, vi } from "vitest";
import { creditSummary } from "@/lib/billing/balance";
import { PlanRestrictionError } from "@/lib/billing/entitlements";
import { InsufficientCreditsError } from "@/lib/billing/reservation";
import { ModerationUnavailableError } from "@/lib/security/moderation";
import { RateLimitedError } from "@/lib/security/rate-limit";
import { SpendPausedError } from "@/lib/security/spend-guard";

// La réservation, les droits et le plan sont testés en base (tests/integration) ; ici, l'enchaînement
// de la Server Action et la traduction de ses issues pour le formulaire.

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

let user: { id: string; email: string } | null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: async (next: string) => user ?? redirect(`/login?next=${encodeURIComponent(next)}`),
}));
let membership: { workspace: { id: string; slug: string; name: string }; role: string; credits: unknown } | null;
vi.mock("@/lib/workspaces/access", () => ({
  findMembership: async () => membership,
  hasRole: (role: string, min: string) => ["viewer", "editor", "admin", "owner"].indexOf(role) >= ["viewer", "editor", "admin", "owner"].indexOf(min),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

const reserve = vi.fn();
vi.mock("@/lib/billing/reservation", async (original) => ({
  ...(await original<typeof import("@/lib/billing/reservation")>()),
  createPipelineWithReservation: (...args: unknown[]) => reserve(...args),
}));
const getChannel = vi.fn();
vi.mock("@/lib/channels/store", () => ({ getChannel: (...args: unknown[]) => getChannel(...args) }));
const send = vi.fn();
vi.mock("@/lib/jobs/client", () => ({ inngest: { send: (...args: unknown[]) => send(...args) } }));

// Limites (tâche 4.5) : leurs règles sont testées à part (tests/unit/security, tests/integration/limits).
const rateLimit = vi.fn();
vi.mock("@/lib/security/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/security/rate-limit")>()),
  enforceRateLimit: (...args: unknown[]) => rateLimit(...args),
}));
const spendGuard = vi.fn();
vi.mock("@/lib/security/spend-guard", async (original) => ({
  ...(await original<typeof import("@/lib/security/spend-guard")>()),
  enforceSpendGuard: (...args: unknown[]) => spendGuard(...args),
}));
const moderate = vi.fn();
vi.mock("@/lib/security/moderation", async (original) => ({
  ...(await original<typeof import("@/lib/security/moderation")>()),
  moderateBrief: (...args: unknown[]) => moderate(...args),
}));

// Funnel (tâche 5.3) : after() s'exécute tout de suite, l'envoi est simulé.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (callback: () => unknown) => callback() }));
const track = vi.fn();
vi.mock("@/lib/analytics/posthog", () => ({ track: (...args: unknown[]) => track(...args) }));

const { createPipeline } = await import("@/app/(app)/w/[workspaceSlug]/pipelines/new/actions");

const KEY = "8b0b2e2a-6f3e-4e0e-9a51-2a8f4c1d9e70";
const PIPELINE = "4d1f7c3e-2b6a-4f8e-9c0d-1a2b3c4d5e6f";
const WS = "9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a";
const brief = { niche: "Histoire", topic: "Les pyramides de Gizeh", language: "fr", tone: "educational", style: "documentary", durationMinutes: "8", tier: "standard" };
const form = (fields: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ workspaceSlug: "mon-espace", idempotencyKey: KEY, ...brief, ...fields })) data.set(key, value);
  return data;
};
const initial = { fieldErrors: {}, values: {} };

beforeEach(() => {
  vi.clearAllMocks();
  user = { id: "user-1", email: "a@test.local" };
  membership = { workspace: { id: WS, slug: "mon-espace", name: "Mon espace" }, role: "owner", credits: creditSummary("free", 30) };
  reserve.mockResolvedValue({ pipelineId: PIPELINE, created: true, credits: 18 });
  send.mockResolvedValue({ ids: ["evt"] });
  rateLimit.mockResolvedValue(undefined);
  spendGuard.mockResolvedValue(undefined);
  moderate.mockResolvedValue({ allowed: true });
});

describe("Server Action createPipeline", () => {
  it("réserve, lance la génération une seule fois par pipeline, puis ouvre la page du pipeline", async () => {
    await expect(createPipeline(initial, form())).rejects.toThrow(`NEXT_REDIRECT /w/mon-espace/pipelines/${PIPELINE}`);
    expect(reserve).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: WS,
      userId: "user-1",
      brief: { niche: "Histoire", topic: "Les pyramides de Gizeh", language: "fr", tone: "educational", style: "documentary", durationMinutes: 8 },
      tier: "standard",
      idempotencyKey: KEY,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "pipeline/requested", data: { pipelineId: PIPELINE, workspaceId: WS }, id: `pipeline-requested:${PIPELINE}` }),
    );
    expect(refresh).toHaveBeenCalledOnce(); // solde de l'en-tête relu
    expect(track).toHaveBeenCalledWith("user-1", { name: "pipeline_created", properties: { tier: "standard", minutes: 8 } }, PIPELINE);
  });

  it("ne compte pas une seconde fois un pipeline déjà créé par la même soumission", async () => {
    reserve.mockResolvedValueOnce({ pipelineId: PIPELINE, created: false, credits: 18 });
    await expect(createPipeline(initial, form())).rejects.toThrow("NEXT_REDIRECT");
    expect(track).not.toHaveBeenCalled();
  });

  it("fige le preset choisi dans le pipeline, relu dans ce workspace", async () => {
    const CHANNEL = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    const preset = { name: "Mystères", niche: "Histoire", defaultLanguage: "fr", voiceProfile: {}, brandRules: { bannedWords: ["secret"], thumbnailPalette: [] } };
    getChannel.mockResolvedValue({ id: CHANNEL, preset, updatedAt: "2026-10-26T00:00:00Z" });
    await expect(createPipeline(initial, form({ channelId: CHANNEL }))).rejects.toThrow("NEXT_REDIRECT");
    expect(getChannel).toHaveBeenCalledWith(expect.anything(), WS, CHANNEL);
    expect(reserve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ brief: expect.objectContaining({ channelId: CHANNEL }), channel: { id: CHANNEL, snapshot: preset } }),
    );
  });

  it("signale un preset supprimé ou d'un autre workspace, sans rien réserver", async () => {
    getChannel.mockResolvedValue(null);
    const state = await createPipeline(initial, form({ channelId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f" }));
    expect(state.fieldErrors).toEqual({ channelId: true });
    expect(reserve).not.toHaveBeenCalled();
  });

  it("renvoie vers la connexion sans session", async () => {
    user = null;
    await expect(createPipeline(initial, form())).rejects.toThrow("NEXT_REDIRECT /login?next=%2Fw%2Fmon-espace%2Fpipelines%2Fnew");
    expect(reserve).not.toHaveBeenCalled();
  });

  it("refuse un non-membre et un lecteur, sans rien réserver", async () => {
    membership = null;
    await expect(createPipeline(initial, form())).rejects.toThrow(/rôle insuffisant/);
    membership = { workspace: { id: WS, slug: "mon-espace", name: "Mon espace" }, role: "viewer", credits: creditSummary("free", 30) };
    await expect(createPipeline(initial, form())).rejects.toThrow(/rôle insuffisant/);
    expect(reserve).not.toHaveBeenCalled();
  });

  it("renvoie les erreurs du brief sans réserver", async () => {
    const state = await createPipeline(initial, form({ durationMinutes: "90" }));
    expect(state.fieldErrors).toHaveProperty("durationMinutes");
    expect(reserve).not.toHaveBeenCalled();
  });

  it("traduit un refus du plan et un solde insuffisant pour le formulaire", async () => {
    reserve.mockRejectedValueOnce(new PlanRestrictionError({ reason: "duration", plan: "free", limit: 10 }));
    expect((await createPipeline(initial, form())).restriction).toEqual({ reason: "duration", plan: "free", limit: 10 });

    reserve.mockRejectedValueOnce(new InsufficientCreditsError(21, 20));
    expect((await createPipeline(initial, form())).insufficient).toEqual({ required: 21, available: 20 });
    expect(send).not.toHaveBeenCalled();
  });

  it("limite par utilisateur et par workspace, vérifie la dépense, puis modère le brief, avant de réserver", async () => {
    await expect(createPipeline(initial, form())).rejects.toThrow("NEXT_REDIRECT");
    expect(rateLimit).toHaveBeenCalledWith(expect.anything(), [
      { rule: "pipelineUser", subject: "user-1" },
      { rule: "pipelineWorkspace", subject: WS },
    ]);
    expect(spendGuard).toHaveBeenCalledWith(expect.anything(), WS);
    expect(moderate).toHaveBeenCalledWith(expect.objectContaining({ topic: "Les pyramides de Gizeh" }));
    expect(rateLimit.mock.invocationCallOrder[0]).toBeLessThan(moderate.mock.invocationCallOrder[0]!);
    expect(moderate.mock.invocationCallOrder[0]).toBeLessThan(reserve.mock.invocationCallOrder[0]!);
  });

  it("refuse sans débit au-delà de la limite, disjoncteur déclenché ou brief refusé, en gardant la saisie", async () => {
    rateLimit.mockRejectedValueOnce(new RateLimitedError(125));
    const limited = await createPipeline(initial, form());
    expect(limited).toMatchObject({ rateLimited: { minutes: 3 }, values: expect.objectContaining({ topic: "Les pyramides de Gizeh" }) });
    expect(spendGuard).not.toHaveBeenCalled();
    expect(moderate).not.toHaveBeenCalled(); // un brief au-delà de la limite ne coûte aucun appel au modèle

    spendGuard.mockRejectedValueOnce(new SpendPausedError("global"));
    expect((await createPipeline(initial, form())).spendPaused).toBe(true);

    moderate.mockResolvedValueOnce({ allowed: false, category: "medical_misinformation" });
    expect((await createPipeline(initial, form())).moderated).toBe("medical_misinformation");

    moderate.mockRejectedValueOnce(new ModerationUnavailableError(new Error("529")));
    expect((await createPipeline(initial, form())).moderationUnavailable).toBe(true);

    expect(reserve).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("laisse remonter une erreur inattendue des limites", async () => {
    rateLimit.mockRejectedValueOnce(new Error("Rate limit : connexion perdue"));
    await expect(createPipeline(initial, form())).rejects.toThrow("connexion perdue");
    expect(reserve).not.toHaveBeenCalled();
  });

  it("libère la réservation si l'événement ne part pas", async () => {
    send.mockRejectedValueOnce(new Error("Inngest injoignable"));
    const state = await createPipeline(initial, form());
    expect(state.launchError).toBe(true);
    expect(rpc).toHaveBeenCalledWith("finalize_pipeline", { p_pipeline: PIPELINE, p_status: "failed" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("refuse une clé de soumission qui n'est pas un UUID", async () => {
    await expect(createPipeline(initial, form({ idempotencyKey: "x" }))).rejects.toThrow(/Clé de soumission/);
  });
});
