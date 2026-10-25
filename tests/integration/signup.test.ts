import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Brief } from "@/lib/ai/schemas";
import { PLANS } from "@/lib/billing/plans";
import { createPipelineWithReservation } from "@/lib/billing/reservation";
import { validBrief } from "../fixtures/assets";
import { admin, cleanup, createUser, unwrap, withPg } from "./helpers";

// Inscription (migration 0009) : profil, workspace personnel et crédits Free créés par le trigger
// sur auth.users, quelle que soit la voie d'inscription (lien magique, Google, API admin).

afterAll(cleanup);

async function personalWorkspace(userId: string) {
  const memberships = unwrap(await admin.from("workspace_members").select("role, workspace_id").eq("user_id", userId));
  expect(memberships).toEqual([{ role: "owner", workspace_id: expect.any(String) }]);
  return unwrap(await admin.from("workspaces").select("id, slug, name, plan_key").eq("id", memberships[0]!.workspace_id).single());
}

describe("trigger d'inscription", () => {
  it("crée le profil, un workspace personnel Free dont l'utilisateur est owner, et lui offre ses crédits", async () => {
    const user = await createUser("jean.dupont");
    const workspace = await personalWorkspace(user.id);
    expect(workspace).toMatchObject({ plan_key: "free", name: expect.stringMatching(/^Espace de jean\.dupont-/) });
    expect(workspace.slug).toMatch(new RegExp(`^jean-dupont-[0-9a-f]{8}-${user.id.replace(/-/g, "").slice(0, 8)}$`));

    const profile = unwrap(await admin.from("profiles").select("display_name").eq("id", user.id).single());
    expect(profile.display_name).toMatch(/^jean\.dupont-/);
    expect(unwrap(await admin.from("credit_accounts").select("balance, reserved").eq("workspace_id", workspace.id).single())).toEqual({
      balance: PLANS.free.credits,
      reserved: 0,
    });
    const ledger = unwrap(await admin.from("credit_ledger").select("kind, amount, idempotency_key, metadata").eq("workspace_id", workspace.id));
    expect(ledger).toEqual([{ kind: "grant", amount: 30, idempotency_key: `grant:signup:${user.id}`, metadata: { reason: "signup" } }]);
  });

  it("offre autant de crédits que le plan Free du catalogue", async () => {
    const { rows } = await withPg((pg) => pg.query<{ credits: number }>("select private.signup_credits() as credits"));
    expect(rows[0]!.credits).toBe(PLANS.free.credits);
  });

  it("prend le nom du compte Google quand il existe", async () => {
    const email = `google-${randomUUID().slice(0, 8)}@test.local`;
    const { user } = unwrap(await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: "Marie Curie" } })) as { user: { id: string } };
    try {
      expect((await personalWorkspace(user.id)).name).toBe("Espace de Marie Curie");
      expect(unwrap(await admin.from("profiles").select("display_name").eq("id", user.id).single()).display_name).toBe("Marie Curie");
    } finally {
      const ws = unwrap(await admin.from("workspace_members").select("workspace_id").eq("user_id", user.id));
      unwrap(await admin.from("workspaces").delete().in("id", ws.map((m) => m.workspace_id)).select());
      unwrap(await admin.auth.admin.deleteUser(user.id));
    }
  });

  it("permet de générer immédiatement : un premier pipeline de 8 min est réservé sur les crédits offerts", async () => {
    const user = await createUser("premier");
    const workspace = await personalWorkspace(user.id);
    const created = await createPipelineWithReservation(admin, {
      workspaceId: workspace.id,
      userId: user.id,
      brief: { ...validBrief, durationMinutes: 8 } as Brief,
      tier: "standard",
      idempotencyKey: randomUUID(),
    });
    expect(created).toMatchObject({ created: true, credits: 18 });

    // Et l'utilisateur, sous RLS, voit son workspace, son solde et son pipeline.
    expect(unwrap(await user.client.from("credit_accounts").select("balance, reserved").eq("workspace_id", workspace.id).single())).toEqual({ balance: 30, reserved: 18 });
    expect(unwrap(await user.client.from("pipelines").select("id").eq("workspace_id", workspace.id))).toEqual([{ id: created.pipelineId }]);
  });

  it("est idempotent : un second provisionnement ne crée ni workspace ni crédits", async () => {
    const user = await createUser("rejoue");
    const workspace = await personalWorkspace(user.id);
    await withPg((pg) => pg.query("select private.provision_user(id, email, raw_user_meta_data) from auth.users where id = $1", [user.id]));

    expect((await personalWorkspace(user.id)).id).toBe(workspace.id);
    expect(unwrap(await admin.from("credit_accounts").select("balance").eq("workspace_id", workspace.id).single()).balance).toBe(30);
  });
});

describe("private.personal_slug", () => {
  it.each([
    ["Jean.Dupont+yt@exemple.fr", "jean-dupont-yt"],
    ["Élodie.Bœuf@exemple.fr", "elodie-b-uf"],
    ["françois@exemple.fr", "francois"],
    ["___@exemple.fr", "espace"],
    [null, "espace"],
    ["un-nom-vraiment-tres-tres-long-pour-un-slug@exemple.fr", "un-nom-vraiment-tres-tre"],
  ])("%s → %s-<8 caractères>, conforme au CHECK des slugs", async (email, base) => {
    const id = randomUUID();
    const { rows } = await withPg((pg) => pg.query<{ slug: string }>("select private.personal_slug($1, $2) as slug", [id, email]));
    const slug = rows[0]!.slug;
    expect(slug).toBe(`${base}-${id.replace(/-/g, "").slice(0, 8)}`);
    expect(slug).toMatch(/^[a-z0-9-]{3,40}$/);
  });
});
