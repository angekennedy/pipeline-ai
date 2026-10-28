// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let user: { id: string; email: string | null };
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => user }));
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));
const responses: Record<string, unknown> = {};
const rpc = vi.fn(async (name: string) => ({ data: responses[name], error: null }));
let comments: { score: number; comment: string; updated_at: string }[] = [];
let failedGenerations: Record<string, unknown>[] = [];
let internalWorkspaces: Array<{ id: string; slug: string; name: string }> = [];
const from = (table: string) => {
  const data = table === "generations" ? failedGenerations : comments;
  const builder = {
    select: () => builder,
    not: () => builder,
    eq: () => builder,
    // Workspaces internes : la liste se termine par order().
    order: () => (table === "workspaces" ? Promise.resolve({ data: internalWorkspaces, error: null }) : builder),
    limit: async () => ({ data, error: null }),
  };
  return builder;
};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));

const { default: AdminPage } = await import("@/app/admin/page");
const page = (days?: string) => AdminPage({ searchParams: Promise.resolve(days ? { days } : {}), params: Promise.resolve({}) } as never);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_EMAILS", "ops@pipeline.test");
  user = { id: "admin-1", email: "ops@pipeline.test" };
  Object.assign(responses, {
    pipeline_economics: [
      {
        pipeline_id: "4d1f7c3e-2b6a-4f8e-9c0d-1a2b3c4d5e6f",
        workspace_id: "ws-1",
        plan_key: "creator",
        model_tier: "standard",
        status: "completed",
        minutes: 8,
        created_at: "2026-10-26T08:00:00.000Z",
        cost_usd_micros: 250_000,
        credits_captured: 18,
        generations: 5,
        failed_generations: 1,
        validation_repairs: 0,
        cache_hit_ratio: 0.62,
        total_latency_ms: 90_000,
      },
    ],
    cost_outliers: [],
    generation_failures: [{ finished: 40, failed: 4 }],
    stale_reservations: 0,
    beta_settings: [{ invite_only: true, invites: [{ email: "ada@test.local", note: "Chaîne Histoire", invited_at: "2026-10-26T08:00:00.000Z" }] }],
    nps_summary: [{ responses: 10, promoters: 6, passives: 2, detractors: 2 }],
  });
  comments = [{ score: 9, comment: "Les titres sont excellents", updated_at: "2026-10-26T09:00:00.000Z" }];
  failedGenerations = [];
  internalWorkspaces = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("page d'administration", () => {
  it("répond 404 à un utilisateur hors de ADMIN_EMAILS, sans rien lire", async () => {
    user = { id: "user-1", email: "user@test.local" };
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("montre coût, chiffre d'affaires et marge de chaque pipeline, et leurs totaux", async () => {
    render(await page());
    expect(screen.getByRole("heading", { level: 1, name: "Coût et marge des pipelines" })).toBeInTheDocument();
    expect(screen.getByText("30 derniers jours, 1 pipeline (au plus 200).")).toBeInTheDocument();

    const [header, line] = within(screen.getByRole("table")).getAllByRole("row");
    expect(within(header!).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Date", "Pipeline", "Plan", "Formule", "Durée", "Statut", "Crédits", "Coût", "CA", "Marge", "Cache", "Échecs",
    ]);
    const cells = within(line!).getAllByRole("cell").map((cell) => cell.textContent?.replace(/\s/g, " "));
    // 0,25 $ × 0,92 = 0,23 € ; 18 crédits × 4,75 c = 0,855 € ; marge 0,625 €, soit 73 %.
    expect(cells.slice(1)).toEqual(["4d1f7c3e", "Creator", "standard", "8 min", "Terminé", "18", "0,23 €", "0,855 €", "0,625 € · 73 %", "62 %", "1/5"]);
    expect(screen.getByText("Marge brute").nextElementSibling?.textContent?.replace(/\s/g, " ")).toBe("0,625 € · 73 %");
  });

  it("liste les alertes du moment, et change de période", async () => {
    render(await page("7"));
    expect(screen.getByText(/^Taux d'échec des générations : 10\s%/)).toHaveTextContent("(4 sur 40)");
    expect(screen.getByRole("link", { name: "7 j" })).toHaveAttribute("aria-current", "page");
    const [, args] = rpc.mock.calls.find(([name]) => name === "pipeline_economics") as unknown as [string, { p_since: string; p_limit: number }];
    expect(Math.abs(Date.now() - new Date(args.p_since).getTime() - 7 * 24 * 3600 * 1000)).toBeLessThan(5000);
    expect(args.p_limit).toBe(200);
  });

  it("gère la bêta fermée et affiche le NPS avec les derniers commentaires", async () => {
    render(await page());
    const beta = screen.getByRole("region", { name: "Bêta fermée" });
    expect(beta).toHaveTextContent("Inscriptions sur invitation : activées.");
    expect(within(beta).getByRole("button", { name: "Ouvrir les inscriptions à tous" })).toBeInTheDocument();
    expect(within(beta).getByText("1 invitation")).toBeInTheDocument();
    expect(within(beta).getByRole("button", { name: "Retirer l'invitation de ada@test.local" })).toBeInTheDocument();

    const nps = screen.getByRole("region", { name: "NPS" });
    expect(nps).toHaveTextContent("Score NPS : 40"); // (6 − 2) / 10
    expect(nps).toHaveTextContent("10 réponses : 6 promoteurs (9-10), 2 passifs (7-8), 2 détracteurs (0-6).");
    expect(within(nps).getByText("9/10 : Les titres sont excellents")).toBeInTheDocument();
  });

  it("affiche le message exact des dernières générations en échec", async () => {
    failedGenerations = [
      {
        id: "gen-1",
        pipeline_id: "9a8b7c6d-2b6a-4f8e-9c0d-1a2b3c4d5e6f",
        asset_type: "script",
        created_at: "2026-10-27T18:45:00.000Z",
        attempt: 4,
        model: null,
        prompt_version: "script@3",
        error_code: "PROVIDER_ERROR",
        error_message: "404 The model `gpt-4o` does not exist or you do not have access to it.",
      },
    ];
    render(await page());
    const errors = screen.getByRole("region", { name: "Dernières erreurs de génération" });
    const [header, line] = within(errors).getAllByRole("row");
    expect(within(header!).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Date", "Pipeline", "Asset", "Code", "Modèle", "Message exact"]);
    expect(within(line!).getByText("9a8b7c6d")).toBeInTheDocument();
    expect(within(line!).getByText("PROVIDER_ERROR")).toBeInTheDocument();
    expect(line).toHaveTextContent("script@3");
    expect(line).toHaveTextContent("tentative 4");
    expect(within(line!).getByText("404 The model `gpt-4o` does not exist or you do not have access to it.")).toBeInTheDocument();
  });

  it("indique qu'aucune génération n'a échoué", async () => {
    render(await page());
    expect(screen.getByRole("region", { name: "Dernières erreurs de génération" })).toHaveTextContent("Aucune génération en échec.");
  });

  it("liste les workspaces internes et permet d'en retirer un", async () => {
    internalWorkspaces = [{ id: "ws-9", slug: "mon-labo", name: "Mon labo" }];
    render(await page());
    const internal = screen.getByRole("region", { name: "Workspaces internes" });
    expect(internal).toHaveTextContent("Mon labo");
    expect(within(internal).getByRole("button", { name: "Retirer le statut interne de mon-labo" })).toBeInTheDocument();
    expect(within(internal).getByLabelText("Slug du workspace")).toBeInTheDocument();
  });
});
