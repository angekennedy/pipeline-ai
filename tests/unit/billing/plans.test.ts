import { describe, expect, it } from "vitest";
import { CREDIT_PACKS, PLANS, formatCredits, formatEuros, isPlanKey } from "@/lib/billing/plans";

describe("catalogue des plans", () => {
  it("reprend les allocations d'ARCHITECTURE §5.1", () => {
    expect(Object.values(PLANS).map((p) => [p.key, p.credits, p.renewal])).toEqual([
      ["free", 30, "once"],
      ["creator", 400, "monthly"],
      ["pro", 1500, "monthly"],
      ["studio", 5000, "monthly"],
    ]);
    expect(CREDIT_PACKS.map((p) => p.credits)).toEqual([200, 1000]);
  });

  it("limite Free à 10 min et réserve Premium et les 5 sièges à Studio", () => {
    expect(PLANS.free.maxDurationMinutes).toBe(10);
    expect(Object.values(PLANS).filter((p) => p.premium).map((p) => p.key)).toEqual(["studio"]);
    expect(PLANS.studio.seats).toBe(5);
  });

  it("reconnaît les clés de plan stockées en base", () => {
    expect(isPlanKey("pro")).toBe(true);
    expect(isPlanKey("enterprise")).toBe(false);
  });

  it("formate les crédits et les prix en français", () => {
    expect(formatCredits(1)).toBe("1 crédit");
    expect(formatCredits(0)).toBe("0 crédit");
    expect(formatCredits(1500)).toBe("1 500 crédits");
    expect(formatEuros(1900)).toBe("19 €");
    expect(formatEuros(0)).toBe("0 €");
  });
});
