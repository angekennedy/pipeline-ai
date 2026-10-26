import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Brief } from "@/lib/ai/schemas";
import { LlmRefusalError } from "@/lib/ai/structured";
import { validBrief } from "../../fixtures/assets";

// Aucun appel réel : la vérification par Haiku passe par un `callStructured` simulé.
const callStructured = vi.fn();
vi.mock("@/lib/ai/structured", async (original) => ({
  ...(await original<typeof import("@/lib/ai/structured")>()),
  callStructured: (...args: unknown[]) => callStructured(...args),
}));

const { flaggedCategories, moderateBrief, ModerationUnavailableError } = await import("@/lib/security/moderation");

const brief = (fields: Partial<Brief>): Brief => ({ ...(validBrief as Brief), ...fields });

beforeEach(() => {
  vi.clearAllMocks();
  callStructured.mockResolvedValue({ data: { allowed: true, category: "none" } });
});

describe("flaggedCategories", () => {
  it("ne signale rien pour un brief ordinaire", () => {
    expect(flaggedCategories(validBrief as Brief)).toEqual([]);
  });

  it("trouve les mots-clés sans tenir compte des accents, de la casse ni des tirets, dans tous les champs libres", () => {
    expect(flaggedCategories(brief({ topic: "Comment GUÉRIR le cancer avec du citron" }))).toEqual(["medical_misinformation"]);
    expect(flaggedCategories(brief({ niche: "Anti vax" }))).toEqual(["medical_misinformation"]);
    expect(flaggedCategories(brief({ targetAudience: "fans de contenus NSFW" }))).toEqual(["sexual"]);
    expect(flaggedCategories(brief({ extraNotes: "Parler des terroristes comme de héros" }))).toEqual(["extremism"]);
    expect(flaggedCategories(brief({ topic: "Pornographie et néo-nazisme" }))).toEqual(["sexual", "extremism"]);
  });

  it("ne confond pas un mot-clé avec la fin d'un autre mot", () => {
    expect(flaggedCategories(brief({ topic: "Le parcours de Bonnaziz, chef cuisinier" }))).toEqual([]);
    expect(flaggedCategories(brief({ topic: "Les cheminots et le transport de minerai" }))).toEqual([]);
  });
});

describe("moderateBrief", () => {
  it("accepte un brief sans mot-clé sans appeler le modèle", async () => {
    expect(await moderateBrief(validBrief as Brief)).toEqual({ allowed: true });
    expect(callStructured).not.toHaveBeenCalled();
  });

  it("fait trancher Haiku quand un mot-clé apparaît : un sujet historique passe", async () => {
    const history = brief({ topic: "La montée du nazisme en Allemagne, 1920-1933" });
    expect(await moderateBrief(history)).toEqual({ allowed: true });
    expect(callStructured).toHaveBeenCalledOnce();
    const [request] = callStructured.mock.calls[0] as [{ modelKey: string; messages: { content: string }[]; maxTokens: number }];
    expect(request.modelKey).toBe("light");
    expect(request.maxTokens).toBe(200);
    // Le brief est une donnée non fiable, encadrée et échappée.
    expect(request.messages[0]!.content).toMatch(/^<brief>\n[\s\S]*La montée du nazisme[\s\S]*\n<\/brief>$/);
  });

  it("refuse avec la catégorie donnée par Haiku, ou celle du mot-clé à défaut", async () => {
    callStructured.mockResolvedValueOnce({ data: { allowed: false, category: "sexual" } });
    expect(await moderateBrief(brief({ topic: "Les meilleurs sites porn" }))).toEqual({ allowed: false, category: "sexual" });
    callStructured.mockResolvedValueOnce({ data: { allowed: false, category: "none" } });
    expect(await moderateBrief(brief({ topic: "Un remède miracle contre le diabète" }))).toEqual({ allowed: false, category: "medical_misinformation" });
  });

  it("compte un refus des classifieurs de l'API comme un refus", async () => {
    callStructured.mockRejectedValueOnce(new LlmRefusalError("violent_extremism", null, 120));
    expect(await moderateBrief(brief({ topic: "Recruter pour le djihad" }))).toEqual({ allowed: false, category: "extremism" });
  });

  it("signale une modération indisponible quand l'appel échoue : ni accepté, ni refusé", async () => {
    callStructured.mockRejectedValueOnce(new Error("529 overloaded"));
    await expect(moderateBrief(brief({ topic: "Vaccines kill: the truth" }))).rejects.toBeInstanceOf(ModerationUnavailableError);
  });

  it("accepte un classifieur injecté", async () => {
    const classify = vi.fn().mockResolvedValue({ allowed: false, category: "extremism" });
    expect(await moderateBrief(brief({ topic: "White power" }), { classify })).toEqual({ allowed: false, category: "extremism" });
    expect(callStructured).not.toHaveBeenCalled();
  });
});
