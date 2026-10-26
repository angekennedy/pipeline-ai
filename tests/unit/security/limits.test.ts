import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { enforceRateLimit, fingerprint, purgeRateLimits, RateLimitedError, retryMinutes } from "@/lib/security/rate-limit";
import { enforceSpendGuard, SpendPausedError, startOfUtcDay } from "@/lib/security/spend-guard";
import type { Database } from "@/lib/supabase/database.types";

// Le comptage lui-même (fenêtre glissante, concurrence, somme des coûts) est testé en base :
// tests/integration/limits.test.ts. Ici, l'appel des RPC et la traduction de leurs réponses.

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code: string } | null }>;
const db = (rpc: Rpc) => ({ rpc: vi.fn(rpc) }) as unknown as SupabaseClient<Database> & { rpc: ReturnType<typeof vi.fn> };

describe("enforceRateLimit", () => {
  it("passe tous les compteurs d'une demande en un appel", async () => {
    const client = db(async () => ({ data: 0, error: null }));
    await enforceRateLimit(client, [
      { rule: "pipelineUser", subject: "u1" },
      { rule: "pipelineWorkspace", subject: "w1" },
    ]);
    expect(client.rpc).toHaveBeenCalledWith("rate_limit_hit", {
      p_buckets: ["pipelineUser:u1", "pipelineWorkspace:w1"],
      p_limits: [10, 30],
      p_windows: [3600, 3600],
    });
  });

  it("lève RateLimitedError avec le délai renvoyé par la base", async () => {
    const error = await enforceRateLimit(db(async () => ({ data: 95, error: null })), [{ rule: "exportUser", subject: "u1" }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error).toMatchObject({ retryAfterSeconds: 95, code: "RATE_LIMITED" });
  });

  it("laisse remonter une erreur de la base, avec son code", async () => {
    const failing = db(async () => ({ data: null, error: { message: "INVALID_RATE_LIMIT", code: "22023" } }));
    await expect(enforceRateLimit(failing, [{ rule: "loginIp", subject: "x" }])).rejects.toMatchObject({ message: "Rate limit : INVALID_RATE_LIMIT", code: "22023" });
    await expect(purgeRateLimits(failing)).rejects.toMatchObject({ code: "22023" });
  });

  it("purge et renvoie le nombre d'horodatages supprimés", async () => {
    expect(await purgeRateLimits(db(async () => ({ data: 4, error: null })))).toBe(4);
  });
});

describe("fingerprint et retryMinutes", () => {
  it("donne la même empreinte quelle que soit la casse, sans la valeur en clair", () => {
    expect(fingerprint(" Ada@Test.local ")).toBe(fingerprint("ada@test.local"));
    expect(fingerprint("ada@test.local")).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprint("ada@test.local")).not.toBe(fingerprint("bob@test.local"));
  });

  it("arrondit le délai à la minute supérieure, au moins une", () => {
    expect(retryMinutes(1)).toBe(1);
    expect(retryMinutes(60)).toBe(1);
    expect(retryMinutes(61)).toBe(2);
    expect(retryMinutes(0)).toBe(1);
  });
});

describe("enforceSpendGuard", () => {
  const NOW = new Date("2026-10-26T23:30:00.000Z");
  const limits = { globalUsd: 100, workspaceUsd: 10 };
  // Dépense en micro-dollars : globale sans `p_workspace`, du workspace sinon.
  const spending = (globalUsd: number, workspaceUsd: number) =>
    db(async (_name, args) => ({ data: (args?.p_workspace ? workspaceUsd : globalUsd) * 1_000_000, error: null }));

  it("compte depuis minuit UTC, globalement et pour le workspace", async () => {
    const client = spending(5, 1);
    await enforceSpendGuard(client, "ws-1", { limits, now: NOW, alert: vi.fn() });
    expect(client.rpc).toHaveBeenCalledWith("spend_since", { p_since: "2026-10-26T00:00:00.000Z", p_workspace: undefined });
    expect(client.rpc).toHaveBeenCalledWith("spend_since", { p_since: "2026-10-26T00:00:00.000Z", p_workspace: "ws-1" });
    expect(startOfUtcDay(new Date("2026-10-27T00:00:00.000Z")).toISOString()).toBe("2026-10-27T00:00:00.000Z");
  });

  it("coupe toutes les générations au seuil global, et alerte", async () => {
    const alert = vi.fn();
    const error = await enforceSpendGuard(spending(100, 1), "ws-1", { limits, now: NOW, alert }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SpendPausedError);
    expect(error).toMatchObject({ scope: "global", code: "SPEND_PAUSED" });
    expect(alert).toHaveBeenCalledWith("global", "ws-1", 100, 100);
  });

  it("coupe un workspace qui dépasse son seuil, et alerte d'un abus possible", async () => {
    const alert = vi.fn();
    await expect(enforceSpendGuard(spending(50, 12.5), "ws-1", { limits, now: NOW, alert })).rejects.toMatchObject({ scope: "workspace" });
    expect(alert).toHaveBeenCalledWith("workspace", "ws-1", 12.5, 10);
  });

  it("laisse passer sous les seuils, sans alerte", async () => {
    const alert = vi.fn();
    await expect(enforceSpendGuard(spending(99.99, 9.99), "ws-1", { limits, now: NOW, alert })).resolves.toBeUndefined();
    expect(alert).not.toHaveBeenCalled();
  });

  it("laisse remonter une erreur de lecture de la dépense", async () => {
    const failing = db(async () => ({ data: null, error: { message: "boom", code: "XX000" } }));
    await expect(enforceSpendGuard(failing, "ws-1", { limits, now: NOW })).rejects.toMatchObject({ message: "Dépense du jour : boom" });
  });
});
