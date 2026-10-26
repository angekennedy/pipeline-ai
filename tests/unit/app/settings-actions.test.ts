import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountDeletionBlockedError } from "@/lib/account/delete";

// La suppression en cascade et ses refus sont testés en base (tests/integration/account-deletion) ;
// ici, ce que les Server Actions vérifient avant, et ce qu'elles font après.

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let user: { id: string; email: string | null };
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => user }));

const updates: Array<{ table: string; values: unknown; filter: [string, string] }> = [];
const signOut = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      update: (values: unknown) => ({
        eq: async (column: string, value: string) => (updates.push({ table, values, filter: [column, value] }), { error: null }),
      }),
    }),
    auth: { signOut },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

let role: string | null;
vi.mock("@/lib/workspaces/access", () => ({
  findMembership: async () => (role ? { workspace: { id: "ws-1", slug: "mon-espace", name: "Mon espace" }, role } : null),
  hasRole: (r: string, min: string) => ["viewer", "editor", "admin", "owner"].indexOf(r) >= ["viewer", "editor", "admin", "owner"].indexOf(min),
}));

const deleteAccount = vi.fn();
vi.mock("@/lib/account/delete", async (original) => ({
  ...(await original<typeof import("@/lib/account/delete")>()),
  deleteAccount: (...args: unknown[]) => deleteAccount(...args),
}));

const { deleteAccountAction, renameWorkspace, updateProfile } = await import("@/app/(app)/settings/actions");

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  user = { id: "user-1", email: "Ada@Test.local" };
  role = "owner";
  deleteAccount.mockResolvedValue(1);
});

describe("updateProfile", () => {
  it("enregistre le nom affiché de l'utilisateur, et seulement le sien", async () => {
    expect(await updateProfile({}, form({ displayName: "  Ada  " }))).toEqual({ saved: true });
    expect(updates).toEqual([{ table: "profiles", values: { display_name: "Ada" }, filter: ["id", "user-1"] }]);
  });

  it("refuse un nom vide ou trop long", async () => {
    for (const displayName of ["   ", "x".repeat(81)]) expect(await updateProfile({}, form({ displayName }))).toMatchObject({ error: expect.any(String) });
    expect(updates).toEqual([]);
  });
});

describe("renameWorkspace", () => {
  it("renomme le workspace pour un admin", async () => {
    role = "admin";
    expect(await renameWorkspace({}, form({ workspaceSlug: "mon-espace", workspaceName: "Studio Ada" }))).toEqual({ saved: true });
    expect(updates).toEqual([{ table: "workspaces", values: { name: "Studio Ada" }, filter: ["id", "ws-1"] }]);
  });

  it("refuse un éditeur et un non-membre", async () => {
    for (const r of ["editor", null]) {
      role = r;
      await expect(renameWorkspace({}, form({ workspaceSlug: "mon-espace", workspaceName: "Piraté" }))).rejects.toThrow("rôle insuffisant");
    }
    expect(updates).toEqual([]);
  });
});

describe("deleteAccountAction", () => {
  it("supprime le compte confirmé par l'adresse e-mail, efface la session puis quitte l'application", async () => {
    await expect(deleteAccountAction({}, form({ confirmation: " ada@test.LOCAL " }))).rejects.toThrow("NEXT_REDIRECT /compte-supprime");
    expect(deleteAccount).toHaveBeenCalledWith(expect.anything(), "user-1");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("ne supprime rien sans la bonne adresse e-mail", async () => {
    for (const confirmation of ["", "autre@test.local", "SUPPRIMER"]) {
      expect(await deleteAccountAction({}, form({ confirmation }))).toEqual({ error: "Saisissez exactement votre adresse e-mail pour confirmer." });
    }
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("affiche le refus de la suppression, sans déconnecter", async () => {
    deleteAccount.mockRejectedValue(new AccountDeletionBlockedError({ reason: "workspace_shared", workspaces: "Équipe" }));
    expect(await deleteAccountAction({}, form({ confirmation: "ada@test.local" }))).toEqual({ error: expect.stringContaining("seul propriétaire de Équipe") });
    expect(signOut).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
