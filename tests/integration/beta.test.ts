import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { addInvite, betaSettings, canSignIn, npsSummary, removeInvite, setInviteOnly } from "@/lib/beta";
import { admin, anon, cleanup, createUser, unwrap } from "./helpers";

// Bêta fermée (migration 0015), contre la vraie base. Les fichiers d'intégration tournent l'un après
// l'autre (fileParallelism: false) ; le mode bêta est remis à « désactivé » après chaque test.

afterEach(() => setInviteOnly(admin, false));
afterAll(cleanup);

const email = (label: string) => `${label}-${randomUUID().slice(0, 8)}@test.local`;
const createAccount = (address: string) => admin.auth.admin.createUser({ email: address, password: `pw-${randomUUID()}`, email_confirm: true });

describe("inscriptions sur invitation", () => {
  it("hors mode bêta, tout le monde peut créer un compte", async () => {
    const address = email("libre");
    expect(await canSignIn(admin, address)).toBe(true);
    const { data, error } = await createAccount(address);
    expect(error).toBeNull();
    await admin.auth.admin.deleteUser(data.user!.id);
  });

  it("en mode bêta, refuse en base la création d'un compte non invité, quelle que soit la voie", async () => {
    await setInviteOnly(admin, true);
    const address = email("non-invite");
    expect(await canSignIn(admin, address)).toBe(false);
    const { data, error } = await createAccount(address);
    expect(error).not.toBeNull(); // le trigger beta_gate fait échouer l'insertion dans auth.users
    expect(data.user).toBeNull();
  });

  it("accepte une adresse invitée, sans tenir compte de la casse, puis la laisse se reconnecter même retirée", async () => {
    await setInviteOnly(admin, true);
    const address = email("invite");
    await addInvite(admin, address.toUpperCase(), "Créatrice Histoire");
    expect(await canSignIn(admin, address)).toBe(true);
    expect((await betaSettings(admin)).invites).toContainEqual(expect.objectContaining({ email: address, note: "Créatrice Histoire" }));

    const { data, error } = await createAccount(address);
    expect(error).toBeNull();
    await removeInvite(admin, address);
    expect(await canSignIn(admin, address)).toBe(true); // compte existant : la connexion reste possible
    await admin.auth.admin.deleteUser(data.user!.id);
  });

  it("garde les réglages et les invitations hors de portée des clients", async () => {
    for (const client of [anon(), (await createUser("beta-curieux")).client]) {
      expect((await client.rpc("set_beta_invite_only", { p_enabled: false })).error).toMatchObject({ code: "42501" });
      expect((await client.rpc("beta_settings")).error).toMatchObject({ code: "42501" });
      expect((await client.rpc("beta_can_sign_in", { p_email: "x@test.local" })).error).toMatchObject({ code: "42501" });
    }
  });
});

describe("NPS", () => {
  it("une réponse par utilisateur, modifiable, invisible des autres, et comptée dans la synthèse", async () => {
    const before = await npsSummary(admin);
    const [ada, bob] = [await createUser("nps-ada"), await createUser("nps-bob")];

    unwrap(await ada.client.from("nps_responses").upsert({ user_id: ada.id, score: 6, comment: "Trop cher" }, { onConflict: "user_id" }).select());
    unwrap(await ada.client.from("nps_responses").upsert({ user_id: ada.id, score: 9 }, { onConflict: "user_id" }).select());
    unwrap(await bob.client.from("nps_responses").insert({ user_id: bob.id, score: 3 }).select());

    expect(unwrap(await ada.client.from("nps_responses").select("user_id, score"))).toEqual([{ user_id: ada.id, score: 9 }]);
    const forged = await bob.client.from("nps_responses").insert({ user_id: ada.id, score: 0 });
    expect(forged.error).toMatchObject({ code: "42501" }); // pas de réponse au nom d'un autre
    expect((await bob.client.from("nps_responses").insert({ user_id: bob.id, score: 11 })).error).not.toBeNull();

    const after = await npsSummary(admin);
    expect(after.responses - before.responses).toBe(2);
    expect(after.promoters - before.promoters).toBe(1);
    expect(after.detractors - before.detractors).toBe(1);
  });
});
