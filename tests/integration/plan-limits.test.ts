import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Brief } from "@/lib/ai/schemas";
import { PlanRestrictionError } from "@/lib/billing/entitlements";
import { PLAN_KEYS, PLANS, type PlanKey } from "@/lib/billing/plans";
import { createPipelineWithReservation } from "@/lib/billing/reservation";
import { validBrief } from "../fixtures/assets";
import { admin, cleanup, createUser, createWorkspace, unwrap, withPg, type TestUser } from "./helpers";

// Restrictions par plan en base (migration 0008) : seconde couche derrière la Server Action.

let owner: TestUser;

beforeAll(async () => {
  owner = await createUser("plans");
});
afterAll(cleanup);

async function workspaceOn(plan: PlanKey, balance = 1000) {
  const workspaceId = await createWorkspace(owner, `plans-${plan}`);
  unwrap(await admin.from("workspaces").update({ plan_key: plan }).eq("id", workspaceId).select());
  await withPg((pg) => pg.query("select private.credit_op($1, 'grant', $2, $3)", [workspaceId, balance, `grant:${workspaceId}`]));
  return workspaceId;
}

const brief = (durationMinutes: number) => ({ ...validBrief, durationMinutes }) as Brief;
const create = (workspaceId: string, durationMinutes: number, tier: "standard" | "premium" = "standard", idempotencyKey: string = randomUUID()) =>
  createPipelineWithReservation(admin, { workspaceId, userId: owner.id, brief: brief(durationMinutes), tier, idempotencyKey });

async function state(workspaceId: string) {
  const account = unwrap(await admin.from("credit_accounts").select("balance, reserved").eq("workspace_id", workspaceId).single());
  const pipelines = unwrap(await admin.from("pipelines").select("id").eq("workspace_id", workspaceId));
  return { ...account, pipelines: pipelines.length };
}

describe("private.plan_limits", () => {
  it("reprend les limites du catalogue TypeScript, et celles de Free pour un plan inconnu", async () => {
    const rows = await withPg(async (pg) => {
      const out: Record<string, unknown> = {};
      for (const key of [...PLAN_KEYS, "legacy"]) {
        out[key] = (await pg.query("select * from private.plan_limits($1)", [key])).rows[0];
      }
      return out;
    });
    for (const key of PLAN_KEYS) {
      const { maxDurationMinutes, premium, channelPresets } = PLANS[key];
      expect(rows[key]).toEqual({ max_duration_minutes: maxDurationMinutes, premium, channel_presets: channelPresets });
    }
    expect(rows.legacy).toEqual(rows.free);
  });
});

describe("création d'un pipeline selon le plan", () => {
  it("limite Free à 10 min : refus 403 explicite, rien de créé ni de réservé", async () => {
    const workspaceId = await workspaceOn("free");
    await expect(create(workspaceId, 10)).resolves.toMatchObject({ created: true });

    const error = await create(workspaceId, 11).catch((e) => e);
    expect(error).toBeInstanceOf(PlanRestrictionError);
    expect(error).toMatchObject({ status: 403, restriction: { reason: "duration", plan: "free", limit: 10 } });
    expect(error.message).toMatch(/^Le plan Free limite les vidéos à 10 min\./);
    expect(await state(workspaceId)).toEqual({ balance: 1000, reserved: 21, pipelines: 1 });
  });

  it("réserve le script Premium au plan Studio", async () => {
    const creator = await workspaceOn("creator");
    await expect(create(creator, 30)).resolves.toMatchObject({ created: true }); // 60 min autorisées
    await expect(create(creator, 8, "premium")).rejects.toMatchObject({ restriction: { reason: "premium", plan: "creator" } });

    const studio = await workspaceOn("studio");
    await expect(create(studio, 8, "premium")).resolves.toMatchObject({ created: true });
  });

  it("bloque les nouveaux pipelines d'un abonnement impayé, sans retirer la lecture", async () => {
    const workspaceId = await workspaceOn("pro");
    const existing = await create(workspaceId, 8);
    unwrap(
      await admin
        .from("subscriptions")
        .insert({ id: `sub_${randomUUID()}`, workspace_id: workspaceId, status: "past_due", price_id: "price_test", plan_key: "pro" })
        .select(),
    );

    await expect(create(workspaceId, 8)).rejects.toMatchObject({ status: 403, restriction: { reason: "subscription_past_due", plan: "pro" } });
    const visible = unwrap(await owner.client.from("pipelines").select("id").eq("workspace_id", workspaceId));
    expect(visible.map((p) => p.id)).toEqual([existing.pipelineId]);
  });

  it("une soumission déjà acceptée se relit même après un changement de plan", async () => {
    const workspaceId = await workspaceOn("studio");
    const first = await create(workspaceId, 30, "premium", "avant-downgrade");
    unwrap(await admin.from("workspaces").update({ plan_key: "free" }).eq("id", workspaceId).select());

    await expect(create(workspaceId, 30, "premium", "avant-downgrade")).resolves.toEqual({ ...first, created: false });
  });
});

// Insertions de presets bloquées sur un verrou (pg_stat_activity).
const lockWaiters = () =>
  withPg((pg) =>
    pg.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
       where wait_event_type = 'Lock' and query ilike '%insert into%channels%' and pid <> pg_backend_pid()`,
    ),
  ).then(({ rows }) => rows[0]!.n);

async function waitUntil(condition: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("condition non atteinte");
}

describe("presets de chaîne selon le plan", () => {
  const insertChannel = (client: TestUser["client"], workspaceId: string, name = randomUUID()) =>
    client.from("channels").insert({ workspace_id: workspaceId, name, niche: "histoire" });

  it("Free : un preset, le second est refusé avec la limite", async () => {
    const workspaceId = await workspaceOn("free");
    expect((await insertChannel(owner.client, workspaceId)).error).toBeNull();

    const { error } = await insertChannel(owner.client, workspaceId);
    expect(error).toMatchObject({ code: "42501", message: "PLAN_RESTRICTED" });
    expect(JSON.parse(error!.details)).toEqual({ reason: "channel_presets", plan: "free", limit: 1 });
  });

  it("des créations simultanées ne dépassent pas la limite", async () => {
    const workspaceId = await workspaceOn("creator"); // 3 presets
    // Une transaction crée un preset sans valider pendant que 3 autres arrivent. Avec le verrou du
    // trigger, elles l'attendent puis comptent son preset : 2 passent. Sans lui, elles ne voient
    // pas la ligne non validée, passent toutes les 3, et le workspace finit avec 4 presets.
    const results = await withPg(async (holder) => {
      await holder.query("begin");
      await holder.query("insert into public.channels (workspace_id, name, niche) values ($1, 'en cours', 'x')", [workspaceId]);
      let settled = 0;
      const pending = Promise.all(Array.from({ length: 3 }, () => insertChannel(admin, workspaceId).then((r) => (settled++, r))));
      await waitUntil(async () => settled === 3 || (await lockWaiters()) >= 3);
      await holder.query("commit");
      return pending;
    });

    expect(results.filter((r) => r.error === null)).toHaveLength(2);
    expect(results.find((r) => r.error)?.error).toMatchObject({ message: "PLAN_RESTRICTED" });
    expect(unwrap(await admin.from("channels").select("id").eq("workspace_id", workspaceId))).toHaveLength(3);
  });

  it("un non-membre reste refusé par la RLS, sans apprendre le plan du workspace", async () => {
    const workspaceId = await workspaceOn("free");
    unwrap(await admin.from("channels").insert({ workspace_id: workspaceId, name: "existant", niche: "x" }).select());
    const outsider = await createUser("plans-outsider");

    const { error } = await insertChannel(outsider.client, workspaceId);
    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(/row-level security/);
  });
});

describe("plan du workspace", () => {
  it("un admin renomme son workspace mais ne peut pas changer de plan lui-même", async () => {
    const workspaceId = await workspaceOn("free");
    const upgrade = await owner.client.from("workspaces").update({ plan_key: "studio" }).eq("id", workspaceId);
    expect(upgrade.error?.code).toBe("42501");
    const billing = await owner.client.from("workspaces").update({ stripe_customer_id: "cus_vol" }).eq("id", workspaceId);
    expect(billing.error?.code).toBe("42501");

    unwrap(await owner.client.from("workspaces").update({ name: "Renommé" }).eq("id", workspaceId).select());
    expect(unwrap(await admin.from("workspaces").select("name, plan_key").eq("id", workspaceId).single())).toEqual({ name: "Renommé", plan_key: "free" });
  });
});
