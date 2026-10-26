import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import type { Database } from "@/lib/supabase/database.types";
import { validBrief } from "../fixtures/assets";

type Db = SupabaseClient<Database>;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

// Service role : contourne la RLS, comme le worker. Sert à préparer les données.
export const admin: Db = createClient<Database>(url, process.env.SUPABASE_SECRET_KEY!, noSession);

// Client navigateur sans session (rôle anon).
export const anon = (): Db => createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, noSession);

// Connexion Postgres directe (superutilisateur) : lecture du catalogue système.
export async function withPg<T>(fn: (pg: Client) => Promise<T>): Promise<T> {
  const pg = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await pg.connect();
  try {
    return await fn(pg);
  } finally {
    await pg.end();
  }
}

type Result = { data: unknown; error: { message: string } | null };

export function unwrap<R extends Result>({ data, error }: R): NonNullable<R["data"]> {
  if (error) throw new Error(error.message);
  if (data === null || data === undefined) throw new Error("aucune donnée");
  return data;
}

export type TestUser = { id: string; client: Db };

// Données synthétiques, supprimées par `cleanup` : utilisateurs `*@test.local`, workspaces dédiés.
const created = { users: [] as string[], workspaces: [] as string[] };

export async function createUser(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@test.local`;
  const password = `pw-${randomUUID()}`;
  const { user } = unwrap(await admin.auth.admin.createUser({ email, password, email_confirm: true })) as { user: { id: string } };
  created.users.push(user.id);
  const client = anon();
  unwrap(await client.auth.signInWithPassword({ email, password }));
  return { id: user.id, client };
}

export async function createWorkspace(owner: TestUser, label: string): Promise<string> {
  const workspace = unwrap(
    await admin.from("workspaces").insert({ slug: `${label}-${randomUUID().slice(0, 8)}`, name: label }).select("id").single(),
  );
  created.workspaces.push(workspace.id);
  unwrap(await admin.from("workspace_members").insert({ workspace_id: workspace.id, user_id: owner.id, role: "owner" }).select());
  return workspace.id;
}

export async function createPipeline(workspaceId: string, createdBy: string): Promise<string> {
  const pipeline = unwrap(
    await admin
      .from("pipelines")
      .insert({ workspace_id: workspaceId, created_by: createdBy, brief: validBrief, idempotency_key: randomUUID() })
      .select("id")
      .single(),
  );
  return pipeline.id;
}

// Workspaces d'abord, puis les utilisateurs. Les workspaces personnels, créés à l'inscription
// (migration 0009), partent avec ceux des tests.
export async function cleanup() {
  if (created.users.length) {
    const personal = unwrap(await admin.from("workspace_members").select("workspace_id").in("user_id", created.users).eq("role", "owner"));
    created.workspaces.push(...personal.map((m) => m.workspace_id));
  }
  if (created.workspaces.length) unwrap(await admin.from("workspaces").delete().in("id", created.workspaces).select());
  for (const id of created.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && error.status !== 404) throw new Error(error.message); // 404 : compte déjà supprimé par le test
  }
  created.users.length = 0;
  created.workspaces.length = 0;
}
