import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanRestrictionError } from "@/lib/billing/entitlements";
import { InsufficientCreditsError } from "@/lib/billing/reservation";
import { AssetValidationError } from "@/lib/pipeline/versions";
import { sceneFieldName } from "@/lib/pipeline/script-form";
import { RateLimitedError } from "@/lib/security/rate-limit";
import { SpendPausedError } from "@/lib/security/spend-guard";
import { validScript } from "../../fixtures/assets";

// Contrôles des Server Actions d'un pipeline et traduction de leurs issues. L'édition, la
// restauration et la régénération elles-mêmes sont testées en base (tests/integration/regeneration).

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "user-1", email: "a@test.local" }) }));
let role: string | null;
vi.mock("@/lib/workspaces/access", () => ({
  findMembership: async () => (role ? { workspace: { id: "ws-1", slug: "mon-espace", name: "Mon espace" }, role } : null),
  hasRole: (r: string, min: string) => ["viewer", "editor", "admin", "owner"].indexOf(r) >= ["viewer", "editor", "admin", "owner"].indexOf(min),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
let pipeline: { status: string } | null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data: pipeline, error: null }) };
      return builder;
    },
  }),
}));
vi.mock("@/lib/supabase/pipeline-store", () => ({
  SupabasePipelineStore: class {
    getCurrentVersion = async () => ({ id: "v1", content: validScript });
  },
}));
const editAsset = vi.fn();
const restoreVersion = vi.fn();
vi.mock("@/lib/pipeline/versions", async (original) => ({
  ...(await original<typeof import("@/lib/pipeline/versions")>()),
  editAsset: (...args: unknown[]) => editAsset(...args),
  restoreVersion: (...args: unknown[]) => restoreVersion(...args),
}));
const requestRegeneration = vi.fn();
vi.mock("@/lib/jobs/request-regeneration", async (original) => ({
  ...(await original<typeof import("@/lib/jobs/request-regeneration")>()),
  requestRegeneration: (...args: unknown[]) => requestRegeneration(...args),
}));

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

const { regenerateAssets, restoreAssetVersion, saveScript } = await import("@/app/(app)/w/[workspaceSlug]/pipelines/[pipelineId]/actions");
const { PipelineBusyError } = await import("@/lib/jobs/request-regeneration");

const PIPELINE = "4d1f7c3e-2b6a-4f8e-9c0d-1a2b3c4d5e6f";
const NONCE = "8b0b2e2a-6f3e-4e0e-9a51-2a8f4c1d9e70";
const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ workspaceSlug: "mon-espace", pipelineId: PIPELINE, ...fields })) {
    for (const v of [value].flat()) data.append(key, v);
  }
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  role = "editor";
  pipeline = { status: "completed" };
  editAsset.mockResolvedValue("v2");
  requestRegeneration.mockResolvedValue({ credits: 6 });
  rateLimit.mockResolvedValue(undefined);
  spendGuard.mockResolvedValue(undefined);
});

describe("saveScript", () => {
  it("enregistre la saisie comme une nouvelle version du script, au nom de l'utilisateur", async () => {
    const narration = "Narration réécrite, assez longue pour être valide.";
    expect(await saveScript({ fieldErrors: {} }, form({ [sceneFieldName(2, "narration")]: narration }))).toEqual({ fieldErrors: {}, saved: true });
    const [pipelineId, type, content, options] = editAsset.mock.calls[0]!;
    expect([pipelineId, type, options.userId]).toEqual([PIPELINE, "script", "user-1"]);
    expect(content.scenes[1].narration).toBe(narration);
  });

  it("renvoie les erreurs par champ d'un script invalide", async () => {
    editAsset.mockRejectedValue(new AssetValidationError([{ path: ["scenes", 0, "narration"], message: "Too small" }]));
    expect(await saveScript({ fieldErrors: {} }, form({}))).toEqual({
      fieldErrors: { [sceneFieldName(1, "narration")]: "narration" },
      error: "fix",
    });
  });

  it("refuse un pipeline encore en cours, un lecteur et un pipeline d'un autre workspace", async () => {
    pipeline = { status: "running" };
    expect(await saveScript({ fieldErrors: {} }, form({}))).toMatchObject({ error: "busy" });
    pipeline = { status: "completed" };
    role = "viewer";
    await expect(saveScript({ fieldErrors: {} }, form({}))).rejects.toThrow("rôle insuffisant");
    role = "editor";
    pipeline = null;
    await expect(saveScript({ fieldErrors: {} }, form({}))).rejects.toThrow("Pipeline introuvable");
    expect(editAsset).not.toHaveBeenCalled();
  });
});

describe("restoreAssetVersion", () => {
  it("restaure la version demandée, pas sur un pipeline en cours", async () => {
    const versionId = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
    await restoreAssetVersion(form({ assetType: "script", versionId }));
    expect(restoreVersion).toHaveBeenCalledWith(PIPELINE, "script", versionId, expect.objectContaining({ userId: "user-1" }));
    pipeline = { status: "running" };
    await expect(restoreAssetVersion(form({ assetType: "script", versionId }))).rejects.toThrow(/encore en cours/);
  });
});

describe("regenerateAssets", () => {
  it("demande la régénération des assets reçus, avec la clé et la consigne", async () => {
    expect(await regenerateAssets({}, form({ assetType: ["titles", "thumbnails"], nonce: NONCE, feedback: "  Plus courts  " }))).toEqual({ requested: true });
    expect(requestRegeneration).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: "ws-1",
      userId: "user-1",
      pipelineId: PIPELINE,
      types: ["titles", "thumbnails"],
      nonce: NONCE,
      feedback: "Plus courts",
    });
  });

  it("traduit les refus : crédits insuffisants, plan, pipeline en cours", async () => {
    requestRegeneration.mockRejectedValueOnce(new InsufficientCreditsError(6, 2));
    expect(await regenerateAssets({}, form({ assetType: "seo", nonce: NONCE }))).toEqual({ insufficient: { required: 6, available: 2 } });
    requestRegeneration.mockRejectedValueOnce(new PlanRestrictionError({ reason: "premium", plan: "free" }));
    expect(await regenerateAssets({}, form({ assetType: "script", nonce: NONCE }))).toEqual({ restriction: { reason: "premium", plan: "free" } });
    requestRegeneration.mockRejectedValueOnce(new PipelineBusyError());
    expect(await regenerateAssets({}, form({ assetType: "seo", nonce: NONCE }))).toEqual({ busy: true });
  });

  it("limite les régénérations par utilisateur et coupe au disjoncteur, sans rien réserver", async () => {
    const request = form({ assetType: "titles", nonce: NONCE });
    rateLimit.mockRejectedValueOnce(new RateLimitedError(30));
    expect(await regenerateAssets({}, request)).toEqual({ rateLimited: { minutes: 1 } });
    expect(rateLimit).toHaveBeenCalledWith(expect.anything(), [{ rule: "regenerateUser", subject: "user-1" }]);
    spendGuard.mockRejectedValueOnce(new SpendPausedError("workspace"));
    expect(await regenerateAssets({}, request)).toEqual({ spendPaused: true });
    expect(requestRegeneration).not.toHaveBeenCalled();
  });

  it("refuse un asset inconnu ou une clé invalide", async () => {
    await expect(regenerateAssets({}, form({ assetType: "video", nonce: NONCE }))).rejects.toThrow();
    await expect(regenerateAssets({}, form({ assetType: "seo", nonce: "pas-un-uuid" }))).rejects.toThrow();
    expect(requestRegeneration).not.toHaveBeenCalled();
  });
});
