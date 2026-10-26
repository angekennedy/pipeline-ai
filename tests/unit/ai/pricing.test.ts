import { describe, expect, it } from "vitest";
import { PRICING, costUsdMicros, messageCostUsdMicros } from "@/lib/ai/pricing";

// 1 token × 1 $/MTok = 1 micro-dollar : les montants attendus se lisent directement.
describe("costUsdMicros", () => {
  it("facture l'entrée et la sortie au tarif du modèle", () => {
    expect(costUsdMicros("claude-opus-5-5", { input_tokens: 1000, output_tokens: 500 })).toBe(1000 * 4 + 500 * 20);
    expect(costUsdMicros("claude-haiku-5-5", { input_tokens: 10_000, output_tokens: 2000 })).toBe(10_000 * 0.1 + 2000 * 0.5);
  });

  it("facture les lectures de cache et les écritures à 5 min (×1,25 de l'entrée)", () => {
    const usage = { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 400 };
    expect(costUsdMicros("claude-sonnet-5-5", usage)).toBe(200 * 2 + 100 * 10 + 1000 * 0.2 + 400 * 2.5);
  });

  it("facture les écritures de cache à 1 h au double du tarif d'entrée", () => {
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 300,
      cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 100 },
    };
    expect(costUsdMicros("claude-opus-5-5", usage)).toBe(200 * 5 + 100 * 8);
  });

  it("arrondit au micro-dollar", () => {
    expect(costUsdMicros("claude-haiku-5-5", { input_tokens: 3, output_tokens: 1 })).toBe(1);
  });

  it("renvoie null pour un modèle sans tarif connu", () => {
    expect(costUsdMicros("claude-inconnu", { input_tokens: 10, output_tokens: 10 })).toBeNull();
  });

  it("connaît les modèles de repli possibles des refus", () => {
    expect(PRICING["claude-opus-4-8"]).toBeDefined();
  });
});

describe("messageCostUsdMicros", () => {
  it("utilise l'usage global sans itérations", () => {
    expect(messageCostUsdMicros({ model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 10, iterations: null } })).toBe(240);
  });

  it("additionne chaque itération au tarif de son propre modèle (refus puis repli)", () => {
    const message = {
      model: "claude-opus-4-8",
      usage: {
        input_tokens: 2000,
        output_tokens: 550,
        iterations: [
          { type: "message", model: "claude-opus-5-5", input_tokens: 1000, output_tokens: 50 },
          { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 1000, output_tokens: 500 },
        ],
      },
    };
    expect(messageCostUsdMicros(message)).toBe(1000 * 4 + 50 * 20 + 1000 * 5 + 500 * 25);
  });

  it("attribue au modèle de la réponse une itération sans modèle", () => {
    const message = { model: "claude-sonnet-5-5", usage: { input_tokens: 0, output_tokens: 0, iterations: [{ model: null, input_tokens: 10, output_tokens: 1 }] } };
    expect(messageCostUsdMicros(message)).toBe(30);
  });

  it("renvoie null si une itération a un modèle sans tarif", () => {
    const message = { model: "claude-sonnet-5-5", usage: { input_tokens: 0, output_tokens: 0, iterations: [{ model: "claude-inconnu", input_tokens: 1, output_tokens: 1 }] } };
    expect(messageCostUsdMicros(message)).toBeNull();
  });
});
