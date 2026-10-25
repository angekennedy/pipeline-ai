import type { RealtimeChannel } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BROADCAST_EVENT, pipelineTopic, type PipelineEvent } from "@/lib/realtime/events";
import { createBroadcastPublisher } from "@/lib/supabase/broadcast";
import { SupabasePipelineStore } from "@/lib/supabase/pipeline-store";
import { admin, anon, cleanup, createPipeline, createUser, createWorkspace, unwrap, withPg, type TestUser } from "./helpers";

// Isolation entre workspaces (migrations 0003 et 0005). Le workspace A contient une ligne dans
// chaque table ; B, membre d'un autre workspace, ne doit en lire aucune, ni rejoindre le canal
// Realtime d'un pipeline de A.

const TABLES = [
  "profiles",
  "workspaces",
  "workspace_members",
  "channels",
  "pipelines",
  "pipeline_assets",
  "asset_versions",
  "generations",
  "credit_accounts",
  "credit_ledger",
  "subscriptions",
  "stripe_events",
] as const;
type Table = (typeof TABLES)[number];

let a: TestUser; // owner du workspace A
let viewer: TestUser; // viewer du workspace A
let b: TestUser; // owner du workspace B
let wsA: string;
let pipelineA: string;
let pipelineB: string;

beforeAll(async () => {
  [a, viewer, b] = await Promise.all([createUser("rls-a"), createUser("rls-viewer"), createUser("rls-b")]);
  wsA = await createWorkspace(a, "rls-a");
  const wsB = await createWorkspace(b, "rls-b");
  unwrap(await admin.from("workspace_members").insert({ workspace_id: wsA, user_id: viewer.id, role: "viewer" }).select());
  pipelineA = await createPipeline(wsA, a.id);
  pipelineB = await createPipeline(wsB, b.id);

  const store = new SupabasePipelineStore(admin);
  const generation = await store.upsertGeneration({ pipelineId: pipelineA, assetType: "script", idempotencyKey: `pipe:${pipelineA}:script`, credits: 4 });
  await store.commitAssetVersion({
    pipelineId: pipelineA,
    assetType: "script",
    content: { hook: "Secret de A" },
    schemaVersion: "script@1",
    source: "user_edit",
    sourceVersions: {},
    restoredFrom: null,
    generation: null,
    createdBy: a.id,
  });
  unwrap(await admin.from("channels").insert({ workspace_id: wsA, name: "Chaîne A", niche: "histoire" }).select());
  unwrap(await admin.from("credit_accounts").insert({ workspace_id: wsA, balance: 30 }).select());
  unwrap(
    await admin
      .from("credit_ledger")
      .insert({ workspace_id: wsA, kind: "grant", amount: 30, balance_after: 30, reserved_after: 0, idempotency_key: `grant:${wsA}`, generation_id: generation.id })
      .select(),
  );
  unwrap(await admin.from("subscriptions").insert({ id: `sub_${wsA}`, workspace_id: wsA, status: "active", price_id: "price_x", plan_key: "creator" }).select());
  unwrap(await admin.from("stripe_events").insert({ id: `evt_${wsA}`, type: "invoice.paid" }).select());
});
afterAll(async () => {
  await admin.from("stripe_events").delete().eq("id", `evt_${wsA}`);
  await cleanup();
});

// Lignes de A visibles par ce client, table par table.
async function visibleRowsOfA(client: TestUser["client"], table: Table): Promise<number> {
  const query =
    table === "profiles"
      ? client.from(table).select("id").eq("id", a.id)
      : table === "workspaces"
        ? client.from(table).select("id").eq("id", wsA)
        : table === "stripe_events"
          ? client.from(table).select("id").eq("id", `evt_${wsA}`)
          : client.from(table).select("workspace_id").eq("workspace_id", wsA);
  return unwrap(await query).length;
}

describe("RLS", () => {
  it("est activée sur toutes les tables du schéma public", async () => {
    const rows = await withPg(async (pg) => {
      const { rows } = await pg.query<{ table: string; rls: boolean }>(
        `select c.relname as table, c.relrowsecurity as rls
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p')`,
      );
      return rows;
    });
    expect(rows.filter((r) => !r.rls).map((r) => r.table)).toEqual([]);
    expect(rows.map((r) => r.table).sort()).toEqual([...TABLES].sort()); // une nouvelle table s'ajoute ici et aux contrôles ci-dessous
  });

  it.each(TABLES)("B ne lit rien de A dans %s", async (table) => {
    expect(await visibleRowsOfA(b.client, table)).toBe(0);
    expect(await visibleRowsOfA(anon(), table)).toBe(0);
  });

  it("A lit ses propres lignes (les contrôles ci-dessus ne sont pas vides par construction)", async () => {
    const counts = Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await visibleRowsOfA(a.client, t)] as const)));
    expect(counts).toEqual({ ...Object.fromEntries(TABLES.map((t) => [t, 1])), workspace_members: 2, stripe_events: 0 });
  });

  it("réserve le registre de crédits et l'abonnement aux admins", async () => {
    expect(await visibleRowsOfA(viewer.client, "pipelines")).toBe(1);
    expect(await visibleRowsOfA(viewer.client, "credit_accounts")).toBe(1);
    expect(await visibleRowsOfA(viewer.client, "credit_ledger")).toBe(0);
    expect(await visibleRowsOfA(viewer.client, "subscriptions")).toBe(0);
  });

  it("refuse les écritures hors des droits du rôle", async () => {
    // Aucun INSERT client sur pipelines, même pour le owner : la création passe par le service role.
    const insert = await a.client.from("pipelines").insert({ workspace_id: wsA, created_by: a.id, brief: {}, idempotency_key: "direct" });
    expect(insert.error?.code).toBe("42501");

    const renamed = unwrap(await b.client.from("workspaces").update({ name: "pris" }).eq("id", wsA).select());
    expect(renamed).toEqual([]);
    const channel = await b.client.from("channels").insert({ workspace_id: wsA, name: "intrus", niche: "x" });
    expect(channel.error?.code).toBe("42501");
    const viewerChannel = await viewer.client.from("channels").insert({ workspace_id: wsA, name: "viewer", niche: "x" });
    expect(viewerChannel.error?.code).toBe("42501");
    const joined = await b.client.from("workspace_members").insert({ workspace_id: wsA, user_id: b.id, role: "owner" });
    expect(joined.error?.code).toBe("42501");
  });

  it("n'expose les RPC du worker qu'au service role", async () => {
    for (const client of [a.client, b.client, anon()]) {
      const { error } = await client.rpc("commit_asset_version", {
        p_pipeline: pipelineA,
        p_type: "script",
        p_content: {},
        p_schema_version: "script@1",
        p_source: "user_edit",
        p_source_versions: {},
      });
      expect(error?.code).toBe("42501");
    }
    expect(unwrap(await admin.from("asset_versions").select("id").eq("workspace_id", wsA))).toHaveLength(1);
  });
});

describe("Realtime", () => {
  const channels: Array<[TestUser["client"], RealtimeChannel]> = [];
  afterAll(async () => {
    for (const [client, channel] of channels) await client.removeChannel(channel);
  });

  async function join(user: TestUser, pipelineId: string, onEvent?: (event: PipelineEvent) => void) {
    await user.client.realtime.setAuth();
    const channel = user.client.channel(pipelineTopic(pipelineId), { config: { private: true } });
    channels.push([user.client, channel]);
    if (onEvent) channel.on("broadcast", { event: BROADCAST_EVENT }, ({ payload }) => onEvent(payload as PipelineEvent));
    return new Promise<string>((resolve) => channel.subscribe((status) => status !== "CLOSED" && resolve(status)));
  }

  // Juste après un `supabase db reset`, Realtime redémarre et refuse un temps tous les abonnements :
  // on attend qu'un abonnement légitime passe, sans quoi un refus ne prouverait rien.
  beforeAll(async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const status = await join(b, pipelineB);
      // Canal d'essai retiré : un second `channel()` sur le même topic renverrait celui-ci, déjà abonné.
      const [client, channel] = channels.pop()!;
      await client.removeChannel(channel);
      if (status === "SUBSCRIBED") return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Realtime ne répond pas : abonnement légitime refusé");
  });

  it("B ne rejoint pas le canal d'un pipeline de A", async () => {
    expect(await join(b, pipelineA)).toBe("CHANNEL_ERROR");
    expect(await join(b, pipelineB)).toBe("SUBSCRIBED");
  });

  it("A reçoit les événements publiés par le worker sur son canal", async () => {
    let deliver!: (event: PipelineEvent) => void;
    const received = new Promise<PipelineEvent>((resolve) => (deliver = resolve));
    expect(await join(a, pipelineA, deliver)).toBe("SUBSCRIBED");
    await createBroadcastPublisher(admin, pipelineA)({ type: "asset.started", asset: "script" });
    await expect(received).resolves.toEqual({ type: "asset.started", asset: "script" });
  });
});
