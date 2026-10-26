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
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

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
  });
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
});
