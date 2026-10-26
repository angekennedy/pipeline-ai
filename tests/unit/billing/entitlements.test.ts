import { describe, expect, it } from "vitest";
import { restrictionFr } from "../../fixtures/i18n";
import { PlanRestrictionError, pipelineRestriction, restrictionMessage } from "@/lib/billing/entitlements";

const minutes = (durationMinutes: number) => ({ durationMinutes });

describe("pipelineRestriction", () => {
  it("limite Free à 10 min, les plans payants à 60 min", () => {
    expect(pipelineRestriction("free", minutes(10), "standard")).toBeNull();
    expect(pipelineRestriction("free", minutes(11), "standard")).toEqual({ reason: "duration", plan: "free", limit: 10 });
    expect(pipelineRestriction("creator", minutes(60), "standard")).toBeNull();
  });

  it("réserve le script Premium aux plans qui l'incluent", () => {
    expect(pipelineRestriction("pro", minutes(8), "premium")).toEqual({ reason: "premium", plan: "pro" });
    expect(pipelineRestriction("studio", minutes(8), "premium")).toBeNull();
  });

  it("bloque tout nouveau pipeline d'un abonnement impayé, avant les autres vérifications", () => {
    expect(pipelineRestriction("studio", minutes(8), "standard", { pastDue: true })).toEqual({ reason: "subscription_past_due", plan: "studio" });
    expect(pipelineRestriction("free", minutes(30), "premium", { pastDue: true })?.reason).toBe("subscription_past_due");
  });

  it("vérifie la durée avant le palier, comme la base", () => {
    expect(pipelineRestriction("free", minutes(30), "premium")?.reason).toBe("duration");
  });
});

describe("messages de refus", () => {
  it("dit ce qui bloque et comment le lever", () => {
    expect(restrictionMessage({ reason: "premium", plan: "creator" }, restrictionFr)).toBe(
      "Le script Premium n'est pas inclus dans le plan Creator. Choisissez la formule Standard, ou passez au plan Studio.",
    );
    expect(restrictionMessage({ reason: "channel_presets", plan: "free", limit: 1 }, restrictionFr)).toBe(
      "Le plan Free est limité à 1 preset de chaîne. Supprimez-en un, ou passez à un plan supérieur.",
    );
    expect(restrictionMessage({ reason: "subscription_past_due", plan: "pro" }, restrictionFr)).toMatch(/paiement .* a échoué.*restent consultables/);
  });

  it("porte le statut 403 et le code PLAN_RESTRICTED, avec un message technique", () => {
    const error = new PlanRestrictionError({ reason: "duration", plan: "free", limit: 10 });
    expect(error).toMatchObject({ status: 403, code: "PLAN_RESTRICTED", name: "PlanRestrictionError" });
    expect(error.message).toBe("Restriction du plan free : duration");
  });
});
