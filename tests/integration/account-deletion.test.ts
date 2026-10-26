import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ChannelPresetSchema, type Brief } from "@/lib/ai/schemas";
import { AccountDeletionBlockedError, deleteAccount } from "@/lib/account/delete";
import { createPipelineWithReservation } from "@/lib/billing/reservation";
import { createChannel } from "@/lib/channels/store";
import { generateAsset } from "@/lib/pipeline/generate-asset";
import { runPipelineSteps, type StepRunner } from "@/lib/pipeline/run-pipeline";
import { SupabasePipelineStore } from "@/lib/supabase/pipeline-store";
import { validBrief, validChannel } from "../fixtures/assets";
import { fakeAnthropic } from "./fake-anthropic";
import { admin, cleanup, createPipeline, createUser, createWorkspace, unwrap, type TestUser } from "./helpers";

// Suppression du compte (tâche 2.6, RGPD) : utilisateur, workspaces dont il est le seul owner et tout
// leur contenu effacés en une transaction ; abonnement annulé avant, sinon rien n'est supprimé.

afterAll(cleanup);

const store = new SupabasePipelineStore(admin);
const step: StepRunner = { run: (_id, fn) => fn() };

const TABLES = [
  "workspaces",
  "pipelines",
  "pipeline_assets",
  "asset_versions",
  "generations",
  "channels",
  "credit_accounts",
  "credit_ledger",
  "subscriptions",
  "workspace_members",
] as const;

async function personal(user: TestUser) {
  return unwrap(await admin.from("workspace_members").select("workspace_id").eq("user_id", user.id).eq("role", "owner").single()).workspace_id;
}

// Lignes restantes du workspace, table par table.
async function remaining(workspaceId: string): Promise<Record<(typeof TABLES)[number], number>> {
  const counts = await Promise.all(
    TABLES.map(async (table) => {
      const { count, error } = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .filter(table === "workspaces" ? "id" : "workspace_id", "eq", workspaceId);
      if (error) throw new Error(error.message);
      return [table, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts) as Record<(typeof TABLES)[number], number>;
}

const userExists = async (id: string) => !(await admin.auth.admin.getUserById(id)).error;

describe("suppression du compte", () => {
  it("efface l'utilisateur, son workspace et tout son contenu", async () => {
    const a = await createUser("del-a");
    const ws = await personal(a);
    await createChannel(a.client, ws, ChannelPresetSchema.parse(validChannel));
    const { pipelineId } = await createPipelineWithReservation(admin, {
      workspaceId: ws,
      userId: a.id,
      brief: validBrief as Brief,
      tier: "standard",
      idempotencyKey: randomUUID(),
    });
    await runPipelineSteps(pipelineId, { step, store, generate: (type) => generateAsset(pipelineId, type, { store, client: fakeAnthropic([]) }) });
    const before = await remaining(ws);
    expect(before).toMatchObject({ workspaces: 1, pipelines: 1, pipeline_assets: 5, asset_versions: 5, generations: 5, channels: 1, credit_accounts: 1 });
    expect(before.credit_ledger).toBeGreaterThan(1); // offre d'inscription, réservation, captures

    expect(await deleteAccount(admin, a.id)).toBe(1);

    expect(await remaining(ws)).toEqual(Object.fromEntries(TABLES.map((table) => [table, 0])));
    expect(unwrap(await admin.from("profiles").select("id").eq("id", a.id))).toEqual([]);
    expect(await userExists(a.id)).toBe(false);
  });

  it("refuse, sans rien supprimer, au seul owner d'un workspace qui a d'autres membres", async () => {
    const [owner, member] = await Promise.all([createUser("del-owner"), createUser("del-member")]);
    const own = await personal(owner);
    const team = await createWorkspace(owner, "equipe");
    unwrap(await admin.from("workspace_members").insert({ workspace_id: team, user_id: member.id, role: "editor" }).select());

    const error = await deleteAccount(admin, owner.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccountDeletionBlockedError);
    expect((error as AccountDeletionBlockedError).block).toEqual({ reason: "workspace_shared", workspaces: "equipe" });
    expect(await userExists(owner.id)).toBe(true);
    expect((await remaining(own)).workspaces).toBe(1); // le workspace personnel aussi
    expect((await remaining(team)).workspace_members).toBe(2);
  });

  it("laisse au workspace d'un autre les pipelines de l'utilisateur, sans auteur", async () => {
    const [owner, editor] = await Promise.all([createUser("del-host"), createUser("del-guest")]);
    const host = await personal(owner);
    unwrap(await admin.from("workspace_members").insert({ workspace_id: host, user_id: editor.id, role: "editor" }).select());
    const pipeline = await createPipeline(host, editor.id);

    expect(await deleteAccount(admin, editor.id)).toBe(1); // son workspace personnel seulement
    expect(unwrap(await admin.from("pipelines").select("created_by").eq("id", pipeline).single())).toEqual({ created_by: null });
    expect(await remaining(host)).toMatchObject({ workspaces: 1, pipelines: 1, workspace_members: 1 });
  });

  it("annule l'abonnement avant de supprimer, et ne supprime rien sans Stripe", async () => {
    const subscriber = await createUser("del-sub");
    const ws = await personal(subscriber);
    const subscription = `sub_test_${randomUUID().slice(0, 8)}`;
    unwrap(await admin.from("subscriptions").insert({ id: subscription, workspace_id: ws, status: "active", price_id: "price_test", plan_key: "creator" }).select());

    // Stripe pas encore branché : le compte resterait facturé, il n'est pas supprimé.
    await expect(deleteAccount(admin, subscriber.id)).rejects.toMatchObject({ block: { reason: "billing_unavailable" } });
    expect(await userExists(subscriber.id)).toBe(true);
    expect((await remaining(ws)).subscriptions).toBe(1);

    // Annulation qui échoue : rien n'est supprimé non plus.
    const failing = vi.fn(async () => Promise.reject(new Error("Stripe indisponible")));
    await expect(deleteAccount(admin, subscriber.id, { cancelSubscriptions: failing })).rejects.toThrow("Stripe indisponible");
    expect(await userExists(subscriber.id)).toBe(true);

    const cancel = vi.fn(async () => {});
    expect(await deleteAccount(admin, subscriber.id, { cancelSubscriptions: cancel })).toBe(1);
    expect(cancel).toHaveBeenCalledWith([subscription]);
    expect(await userExists(subscriber.id)).toBe(false);
    expect((await remaining(ws)).subscriptions).toBe(0);
  });

  it("refuse en base un abonnement resté actif, même appelée directement", async () => {
    const subscriber = await createUser("del-direct");
    const ws = await personal(subscriber);
    const subscription = { id: `sub_test_${randomUUID().slice(0, 8)}`, workspace_id: ws, status: "past_due", price_id: "price_test", plan_key: "creator" };
    unwrap(await admin.from("subscriptions").insert(subscription).select());
    const { error } = await admin.rpc("delete_account", { p_user: subscriber.id });
    expect(error?.message).toBe("SUBSCRIPTION_ACTIVE");
    expect(await userExists(subscriber.id)).toBe(true);
  });

  it("n'est pas appelable par un utilisateur, même pour son propre compte", async () => {
    const user = await createUser("del-self");
    const { error } = await user.client.rpc("delete_account", { p_user: user.id });
    expect(error?.code).toBe("42501");
    expect(await userExists(user.id)).toBe(true);
  });
});
