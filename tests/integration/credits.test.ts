import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Brief } from "@/lib/ai/schemas";
import { InsufficientCreditsError, createPipelineWithReservation } from "@/lib/billing/reservation";
import { validBrief } from "../fixtures/assets";
import { admin, anon, cleanup, createUser, createWorkspace, unwrap, withPg, type TestUser } from "./helpers";

// Réservation des crédits à la création d'un pipeline (migration 0006, ARCHITECTURE §5.2), en base
// réelle : les appels simultanés passent par PostgREST, chacun sur sa propre connexion.

const brief = { ...validBrief, durationMinutes: 10 } as Brief; // 21 crédits en standard

let owner: TestUser;

beforeAll(async () => {
  owner = await createUser("credits");
});
afterAll(cleanup);

async function workspaceWith(balance: number) {
  const workspaceId = await createWorkspace(owner, "credits");
  if (balance > 0) await grant(workspaceId, balance, `grant:${workspaceId}`);
  return workspaceId;
}

// credit_op est dans le schéma `private`, hors de PostgREST : appel direct en SQL.
const grant = (workspaceId: string, amount: number, key: string) =>
  withPg((pg) => pg.query("select private.credit_op($1, 'grant', $2, $3)", [workspaceId, amount, key]));

async function account(workspaceId: string) {
  return unwrap(await admin.from("credit_accounts").select("balance, reserved").eq("workspace_id", workspaceId).single());
}

async function ledger(workspaceId: string) {
  return unwrap(await admin.from("credit_ledger").select("kind, amount, idempotency_key, pipeline_id").eq("workspace_id", workspaceId).order("id"));
}

// Réservation lancée sur sa propre connexion. Renvoie l'erreur Postgres au lieu de la lever.
const reserve = (workspaceId: string, credits: number) =>
  withPg((pg) =>
    pg
      .query("select * from public.create_pipeline_with_reservation($1, $2, $3, 'standard', $4, $5)", [workspaceId, owner.id, brief, credits, randomUUID()])
      .then(() => null, (error: { message: string; code: string; detail: string }) => error),
  );

// Attend que `count` réservations soient bloquées sur un verrou (pg_stat_activity).
async function waitForLockedReservations(count: number) {
  for (let i = 0; i < 100; i++) {
    const { rows } = await withPg((pg) =>
      pg.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity
         where wait_event_type = 'Lock' and query like '%create_pipeline_with_reservation%' and pid <> pg_backend_pid()`,
      ),
    );
    if (rows[0]!.n >= count) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${count} réservations attendues en attente de verrou`);
}

describe("create_pipeline_with_reservation", () => {
  it("10 réservations simultanées de 10 crédits sur un solde de 15 donnent exactement 1 succès", async () => {
    const workspaceId = await workspaceWith(15);
    // Chevauchement garanti : le compte est verrouillé le temps que les 10 réservations attendent
    // toutes, puis libéré d'un coup. Sans FOR UPDATE dans credit_op, elles liraient le même solde.
    const results = await withPg(async (holder) => {
      await holder.query("begin");
      await holder.query("select 1 from public.credit_accounts where workspace_id = $1 for update", [workspaceId]);
      const pending = Promise.all(Array.from({ length: 10 }, () => reserve(workspaceId, 10)));
      await waitForLockedReservations(10);
      await holder.query("commit");
      return pending;
    });

    expect(results.filter((error) => error === null)).toHaveLength(1);
    const failures = results.filter((error) => error !== null);
    expect(failures).toHaveLength(9);
    for (const error of failures) {
      expect(error).toMatchObject({ message: "INSUFFICIENT_CREDITS", code: "P0001" });
      expect(JSON.parse(error!.detail)).toEqual({ required: 10, available: 5 });
    }

    expect(await account(workspaceId)).toEqual({ balance: 15, reserved: 10 });
    expect((await ledger(workspaceId)).map((e) => e.kind)).toEqual(["grant", "reserve"]);
    const pipelines = unwrap(await admin.from("pipelines").select("id").eq("workspace_id", workspaceId));
    expect(pipelines).toHaveLength(1); // les 9 refus n'ont rien laissé
  });

  it("crée le pipeline, ses 5 assets en attente et la réservation de son coût total", async () => {
    const workspaceId = await workspaceWith(30);
    const result = await createPipelineWithReservation(admin, { workspaceId, userId: owner.id, brief, tier: "standard", idempotencyKey: "form-1" });
    expect(result).toMatchObject({ created: true, credits: 21 });

    const pipeline = unwrap(await admin.from("pipelines").select("status, credits_reserved, created_by, brief, model_tier").eq("id", result.pipelineId).single());
    expect(pipeline).toEqual({ status: "queued", credits_reserved: 21, created_by: owner.id, brief, model_tier: "standard" });
    const assets = unwrap(await admin.from("pipeline_assets").select("type, status").eq("pipeline_id", result.pipelineId).order("type"));
    expect(assets).toEqual(["script", "titles", "seo", "voiceover", "thumbnails"].map((type) => ({ type, status: "pending" })));

    expect(await account(workspaceId)).toEqual({ balance: 30, reserved: 21 });
    expect((await ledger(workspaceId)).at(-1)).toEqual({ kind: "reserve", amount: 21, idempotency_key: `reserve:pipe:${result.pipelineId}`, pipeline_id: result.pipelineId });
  });

  it("un double clic (même clé, appels simultanés) ne crée qu'un pipeline et ne débite qu'une fois", async () => {
    const workspaceId = await workspaceWith(100);
    const submit = () => createPipelineWithReservation(admin, { workspaceId, userId: owner.id, brief, tier: "standard", idempotencyKey: "double-clic" });
    const results = await Promise.all(Array.from({ length: 5 }, submit));

    expect(new Set(results.map((r) => r.pipelineId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await account(workspaceId)).toEqual({ balance: 100, reserved: 21 });
    expect((await ledger(workspaceId)).filter((e) => e.kind === "reserve")).toHaveLength(1);

    // Rejouée plus tard (retry réseau), la soumission renvoie toujours le même pipeline.
    expect(await submit()).toMatchObject({ pipelineId: results[0]!.pipelineId, created: false });
  });

  it("refuse sans rien créer quand le solde disponible est insuffisant", async () => {
    const workspaceId = await workspaceWith(20);
    const error = await createPipelineWithReservation(admin, { workspaceId, userId: owner.id, brief, tier: "standard", idempotencyKey: "trop-cher" }).catch((e) => e);
    expect(error).toBeInstanceOf(InsufficientCreditsError);
    expect(error).toMatchObject({ required: 21, available: 20 });

    expect(unwrap(await admin.from("pipelines").select("id").eq("workspace_id", workspaceId))).toEqual([]);
    expect(await account(workspaceId)).toEqual({ balance: 20, reserved: 0 });

    // Le même formulaire, une fois le compte rechargé, aboutit : l'échec n'a pas consommé la clé.
    await grant(workspaceId, 10, `grant:${workspaceId}:recharge`);
    await expect(createPipelineWithReservation(admin, { workspaceId, userId: owner.id, brief, tier: "standard", idempotencyKey: "trop-cher" })).resolves.toMatchObject({ created: true });
  });

  it("revérifie les droits : viewer, non-membre et preset d'un autre workspace refusés", async () => {
    const workspaceId = await workspaceWith(100);
    const [viewer, outsider] = await Promise.all([createUser("credits-viewer"), createUser("credits-outsider")]);
    unwrap(await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: viewer.id, role: "viewer" }).select());

    for (const user of [viewer, outsider]) {
      const { error } = await admin.rpc("create_pipeline_with_reservation", { p_workspace: workspaceId, p_user: user.id, p_brief: brief, p_tier: "standard", p_credits: 21, p_key: randomUUID() });
      expect(error).toMatchObject({ message: "FORBIDDEN", code: "42501" });
    }

    const otherWorkspace = await createWorkspace(owner, "credits-other");
    const foreign = unwrap(await admin.from("channels").insert({ workspace_id: otherWorkspace, name: "Autre", niche: "x" }).select("id").single());
    const { error } = await admin.rpc("create_pipeline_with_reservation", {
      p_workspace: workspaceId,
      p_user: owner.id,
      p_brief: brief,
      p_tier: "standard",
      p_credits: 21,
      p_key: randomUUID(),
      p_channel: foreign.id,
    });
    expect(error).toMatchObject({ message: "CHANNEL_NOT_FOUND" });
    expect(await account(workspaceId)).toEqual({ balance: 100, reserved: 0 });
  });

  it("n'est appelable qu'en service role", async () => {
    const workspaceId = await workspaceWith(100);
    for (const client of [owner.client, anon()]) {
      const { error } = await client.rpc("create_pipeline_with_reservation", { p_workspace: workspaceId, p_user: owner.id, p_brief: brief, p_tier: "standard", p_credits: 21, p_key: randomUUID() });
      expect(error?.code).toBe("42501");
    }
    expect(await account(workspaceId)).toEqual({ balance: 100, reserved: 0 });
  });
});

describe("credit_op", () => {
  it("n'applique qu'une fois une même clé envoyée en parallèle", async () => {
    const workspaceId = await workspaceWith(0);
    const key = `purchase:${randomUUID()}`;
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => grant(workspaceId, 200, key)));

    expect(results.every((r) => r.status === "fulfilled")).toBe(true); // aucune violation d'unicité
    expect(await account(workspaceId)).toEqual({ balance: 200, reserved: 0 });
    expect(await ledger(workspaceId)).toHaveLength(1);
  });
});
