import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { enforceRateLimit, RateLimitedError } from "@/lib/security/rate-limit";
import { enforceSpendGuard, SpendPausedError } from "@/lib/security/spend-guard";
import { admin, anon, cleanup, createPipeline, createUser, createWorkspace, unwrap, withPg } from "./helpers";

// Rate limits et dépense du jour (migration 0013), contre la vraie base.

afterAll(cleanup);

const bucket = (label: string) => `test:${label}:${randomUUID().slice(0, 8)}`;
const hit = (buckets: string[], limits: number[], windows: number[]) => admin.rpc("rate_limit_hit", { p_buckets: buckets, p_limits: limits, p_windows: windows });

describe("rate_limit_hit", () => {
  it("accepte exactement `limit` demandes simultanées, puis donne le délai d'attente", async () => {
    const name = bucket("concurrent");
    const results = await Promise.all(Array.from({ length: 10 }, () => hit([name], [3], [3600])));
    const retries = results.map((result) => unwrap(result) as number);

    expect(retries.filter((retry) => retry === 0)).toHaveLength(3);
    for (const retry of retries.filter((value) => value > 0)) expect(retry).toBeGreaterThan(3590);
    expect(await withPg(async (pg) => (await pg.query("select count(*)::int as n from private.rate_limit_hits where bucket = $1", [name])).rows[0].n)).toBe(3);
  });

  it("libère une place quand le plus ancien horodatage sort de la fenêtre glissante", async () => {
    const name = bucket("sliding");
    await withPg((pg) =>
      pg.query("insert into private.rate_limit_hits (bucket, hit_at) values ($1, now() - interval '50 minutes'), ($1, now() - interval '10 minutes')", [name]),
    );
    const retry = unwrap(await hit([name], [2], [3600])) as number;
    expect(retry).toBeGreaterThan(9 * 60); // le premier sort dans 10 min
    expect(retry).toBeLessThanOrEqual(10 * 60);

    await withPg((pg) => pg.query("update private.rate_limit_hits set hit_at = now() - interval '61 minutes' where bucket = $1 and hit_at < now() - interval '30 minutes'", [name]));
    expect(unwrap(await hit([name], [2], [3600]))).toBe(0);
  });

  it("ne compte une demande dans aucun compteur si l'un d'eux la refuse", async () => {
    const [user, workspace] = [bucket("user"), bucket("workspace")];
    expect(unwrap(await hit([workspace], [1], [3600]))).toBe(0); // workspace plein
    expect(unwrap(await hit([user, workspace], [5, 1], [3600, 3600]))).toBeGreaterThan(0);
    expect(await withPg(async (pg) => (await pg.query("select count(*)::int as n from private.rate_limit_hits where bucket = $1", [user])).rows[0].n)).toBe(0);
  });

  it("rejette un appel mal formé, et n'est appelable qu'en service role", async () => {
    for (const [buckets, limits, windows] of [[[], [], []], [["a b c"], [1], [60]], [[bucket("x")], [0], [60]], [[bucket("x")], [1], [90000]], [[bucket("x")], [1, 2], [60]]] as const) {
      const { error } = await hit([...buckets], [...limits], [...windows]);
      expect(error).toMatchObject({ message: "INVALID_RATE_LIMIT", code: "22023" });
    }
    const { error } = await anon().rpc("rate_limit_hit", { p_buckets: [bucket("anon")], p_limits: [1], p_windows: [60] });
    expect(error).toMatchObject({ code: "42501" });
  });

  it("purge les horodatages de plus d'un jour, pas les autres", async () => {
    const name = bucket("purge");
    await withPg((pg) =>
      pg.query("insert into private.rate_limit_hits (bucket, hit_at) values ($1, now() - interval '25 hours'), ($1, now() - interval '23 hours')", [name]),
    );
    expect(unwrap(await admin.rpc("purge_rate_limits"))).toBeGreaterThanOrEqual(1);
    expect(await withPg(async (pg) => (await pg.query("select count(*)::int as n from private.rate_limit_hits where bucket = $1", [name])).rows[0].n)).toBe(1);
  });

  it("se lit depuis l'application : RateLimitedError au-delà de la limite", async () => {
    const subject = randomUUID();
    for (let i = 0; i < 10; i++) await enforceRateLimit(admin, [{ rule: "pipelineUser", subject }]);
    await expect(enforceRateLimit(admin, [{ rule: "pipelineUser", subject }])).rejects.toBeInstanceOf(RateLimitedError);
  });
});

describe("spend_since et disjoncteur", () => {
  // Générations datées de 2099 : la dépense « depuis 2099 » ne compte que celles de ce test.
  const FUTURE = new Date("2099-01-01T12:00:00.000Z");

  it("additionne les coûts, échecs compris, globalement et par workspace", async () => {
    const owner = await createUser("limits-owner");
    const [first, second] = [await createWorkspace(owner, "limits-a"), await createWorkspace(owner, "limits-b")];
    const generation = async (workspaceId: string, cost: number | null, status: "succeeded" | "failed") => {
      const pipelineId = await createPipeline(workspaceId, owner.id);
      unwrap(
        await admin
          .from("generations")
          .insert({ workspace_id: workspaceId, pipeline_id: pipelineId, asset_type: "script", idempotency_key: `pipe:${randomUUID()}`, credits: 1, status, cost_usd_micros: cost, created_at: FUTURE.toISOString() })
          .select(),
      );
    };
    await generation(first, 4_000_000, "succeeded");
    await generation(first, 1_500_000, "failed"); // facturé par l'API malgré l'échec
    await generation(second, 2_000_000, "succeeded");
    await generation(second, null, "failed"); // coût inconnu

    const since = "2099-01-01T00:00:00.000Z";
    expect(unwrap(await admin.rpc("spend_since", { p_since: since }))).toBe(7_500_000);
    expect(unwrap(await admin.rpc("spend_since", { p_since: since, p_workspace: first }))).toBe(5_500_000);

    const guard = (workspaceId: string, limits: { globalUsd: number; workspaceUsd: number }) =>
      enforceSpendGuard(admin, workspaceId, { limits, now: FUTURE, alert: () => {} });
    await expect(guard(second, { globalUsd: 100, workspaceUsd: 5 })).resolves.toBeUndefined();
    await expect(guard(first, { globalUsd: 100, workspaceUsd: 5 })).rejects.toMatchObject({ scope: "workspace" });
    await expect(guard(second, { globalUsd: 7.5, workspaceUsd: 5 })).rejects.toBeInstanceOf(SpendPausedError);
  });
});
