import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPipeline } from "@/app/pipelines/new/actions";

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const brief = { niche: "Histoire", topic: "Les pyramides de Gizeh", language: "fr", tone: "educational", style: "documentary" };
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...brief, ...fields })) data.set(key, value);
  return data;
};
const initial = { fieldErrors: {}, values: {} };

beforeEach(() => {
  redirect.mockClear();
});

// Mode démo : plan Free, 20 crédits disponibles (lib/demo/credits.ts).
describe("Server Action createPipeline", () => {
  it("lance le pipeline quand le plan l'autorise et que le solde couvre son coût", async () => {
    await expect(createPipeline(initial, form({ durationMinutes: "8", tier: "standard" }))).rejects.toThrow("NEXT_REDIRECT /pipelines/demo-running");
  });

  it("refuse sans rien lancer quand le coût dépasse le solde, et renvoie les montants du modal", async () => {
    const values = { ...brief, durationMinutes: "10", tier: "standard" };
    expect(await createPipeline(initial, form(values))).toEqual({ fieldErrors: {}, values, insufficient: { required: 21, available: 20 } });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("refuse une durée au-delà de la limite du plan, avant de regarder le solde", async () => {
    const state = await createPipeline(initial, form({ durationMinutes: "15", tier: "standard" }));
    expect(state.restriction).toEqual({ reason: "duration", plan: "free", limit: 10 });
    expect(state.insufficient).toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("refuse le script Premium à un plan qui ne l'inclut pas", async () => {
    const state = await createPipeline(initial, form({ durationMinutes: "8", tier: "premium" }));
    expect(state.restriction).toEqual({ reason: "premium", plan: "free" });
  });

  it("valide le brief avant le plan et le coût", async () => {
    const state = await createPipeline(initial, form({ durationMinutes: "90" }));
    expect(state.fieldErrors).toHaveProperty("durationMinutes");
    expect(state.restriction).toBeUndefined();
    expect(state.insufficient).toBeUndefined();
  });
});
