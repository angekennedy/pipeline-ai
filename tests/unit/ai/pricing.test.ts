import { describe, expect, it } from "vitest";
import { baseModel, costUsdMicros } from "@/lib/ai/pricing";

// 1 token × 1 $/MTok = 1 micro-dollar : les montants attendus se lisent directement.
describe("costUsdMicros", () => {
  it("facture l'entrée et la sortie au tarif du modèle", () => {
    expect(costUsdMicros("gpt-4o", { prompt_tokens: 1000, completion_tokens: 500 })).toBe(1000 * 2.5 + 500 * 10);
    expect(costUsdMicros("gpt-4o-mini", { prompt_tokens: 10_000, completion_tokens: 2000 })).toBe(10_000 * 0.15 + 2000 * 0.6);
  });

  it("facture les tokens lus en cache, inclus dans prompt_tokens, au tarif réduit", () => {
    const usage = { prompt_tokens: 1200, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 1000 } };
    expect(costUsdMicros("gpt-4o", usage)).toBe(200 * 2.5 + 1000 * 1.25 + 100 * 10);
  });

  it("reconnaît les instantanés datés renvoyés par l'API", () => {
    expect(baseModel("gpt-4o-2024-08-06")).toBe("gpt-4o");
    expect(baseModel("gpt-4o-mini-2024-07-18")).toBe("gpt-4o-mini");
    expect(costUsdMicros("gpt-4o-2024-08-06", { prompt_tokens: 10, completion_tokens: 10 })).toBe(125);
  });

  it("arrondit au micro-dollar", () => {
    expect(costUsdMicros("gpt-4o-mini", { prompt_tokens: 3, completion_tokens: 1 })).toBe(1);
  });

  it("renvoie null pour un modèle sans tarif connu", () => {
    expect(costUsdMicros("gpt-inconnu", { prompt_tokens: 10, completion_tokens: 10 })).toBeNull();
  });
});
