import { describe, expect, it } from "vitest";
import { isAppRoute, safeNext } from "@/lib/auth/routes";

describe("isAppRoute", () => {
  it("protège les routes de l'application et leurs sous-chemins", () => {
    for (const path of ["/pipelines/new", "/w", "/w/mon-espace/pipelines", "/settings", "/settings/account"]) {
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
