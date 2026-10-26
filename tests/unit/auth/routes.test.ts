import { describe, expect, it } from "vitest";
import { isAppRoute, safeNext, workspaceTarget } from "@/lib/auth/routes";

describe("isAppRoute", () => {
  it("protège les routes de l'application et leurs sous-chemins", () => {
    for (const path of ["/billing", "/dashboard", "/pipelines/new", "/w", "/w/mon-espace/pipelines", "/settings", "/settings/account"]) {
      expect(isAppRoute(path), path).toBe(true);
    }
  });

  it("laisse publiques l'accueil, les tarifs, la connexion et les démonstrations", () => {
    for (const path of ["/", "/pricing", "/login", "/auth/confirm", "/pipelines/demo-completed", "/workshop", "/settingsx"]) {
      expect(isAppRoute(path), path).toBe(false);
    }
  });
});

describe("safeNext", () => {
  it("garde un chemin interne, avec sa requête", () => {
    expect(safeNext("/pipelines/new?x=1")).toBe("/pipelines/new?x=1");
  });

  it("refuse toute destination hors du site", () => {
    for (const value of ["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "", null, undefined]) {
      expect(safeNext(value), String(value)).toBe("/");
    }
  });
});

describe("workspaceTarget", () => {
  const id = "4d1f7c3e-2b6a-4f8e-9c0d-1a2b3c4d5e6f";
  it("repère le workspace et le pipeline ou le preset visés par l'URL", () => {
    expect(workspaceTarget("/w/mon-espace")).toEqual({ slug: "mon-espace", resource: null, invalid: false });
    expect(workspaceTarget("/w/mon-espace/pipelines/new")).toEqual({ slug: "mon-espace", resource: null, invalid: false });
    expect(workspaceTarget("/w/mon-espace/channels/new")).toEqual({ slug: "mon-espace", resource: null, invalid: false });
    expect(workspaceTarget(`/w/mon-espace/pipelines/${id}`)).toEqual({ slug: "mon-espace", resource: { table: "pipelines", id }, invalid: false });
    expect(workspaceTarget(`/w/mon-espace/channels/${id}`)).toEqual({ slug: "mon-espace", resource: { table: "channels", id }, invalid: false });
    expect(workspaceTarget("/w/mon-espace/pipelines/pas-un-uuid")).toMatchObject({ invalid: true });
    expect(workspaceTarget("/w/mon-espace/channels/pas-un-uuid")).toMatchObject({ invalid: true });
  });

  it("ignore les autres routes", () => {
    for (const path of ["/", "/pipelines/new", "/pipelines/demo-running", "/workshop"]) expect(workspaceTarget(path), path).toBeNull();
  });
});
