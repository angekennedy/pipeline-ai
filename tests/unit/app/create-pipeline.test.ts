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

// Mode démo : solde Free de 30 crédits (lib/demo/credits.ts).
describe("Server Action createPipeline", () => {
  it("lance le pipeline quand le solde couvre son coût", async () => {
    await expect(createPipeline(initial, form({ durationMinutes: "10", tier: "standard" }))).rejects.toThrow("NEXT_REDIRECT /pipelines/demo-running");
  });

  it("refuse sans rien lancer quand le coût dépasse le solde, et renvoie les montants du modal", async () => {
    const values = { ...brief, durationMinutes: "10", tier: "premium" };
    expect(await createPipeline(initial, form(values))).toEqual({ fieldErrors: {}, values, insufficient: { required: 35, available: 30 } });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("valide le brief avant de comparer le coût", async () => {
    const state = await createPipeline(initial, form({ durationMinutes: "90" }));
    expect(state.fieldErrors).toHaveProperty("durationMinutes");
    expect(state.insufficient).toBeUndefined();
  });
});
