// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validBrief } from "../../fixtures/assets";

const PIPELINE_ID = "9a8b7c6d-2b6a-4f8e-9c0d-1a2b3c4d5e6f";

let user: { id: string; email: string | null };
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => user }));
vi.mock("@/lib/workspaces/access", () => ({
  requireMembership: async () => ({ workspace: { id: "ws-1", slug: "histoire", name: "Histoire" }, role: "owner" }),
  hasRole: () => true,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/pipeline/load-view", () => ({
  loadPipelineView: async () => ({ id: PIPELINE_ID, brief: validBrief, tier: "standard", status: "failed", createdAt: "2026-10-27T18:45:00.000Z", assets: { script: { status: "failed" } } }),
}));
// L'écran du pipeline a ses propres tests : seul le diagnostic compte ici.
vi.mock("@/components/pipeline/pipeline-screen", () => ({ StaticPipeline: () => null, LivePipeline: () => null }));
vi.mock("@/components/pipeline/export-menu", () => ({ ExportMenu: () => null }));

const failed = [
  {
    id: "gen-1",
    pipeline_id: PIPELINE_ID,
    asset_type: "script",
    created_at: "2026-10-27T18:45:00.000Z",
    attempt: 4,
    model: null,
    prompt_version: "script@3",
    error_code: "PROVIDER_ERROR",
    error_message: "401 Incorrect API key provided.",
  },
];
const eq = vi.fn();
const from = vi.fn(() => {
  const builder = { select: () => builder, eq: (...args: unknown[]) => (eq(...args), builder), order: () => builder, limit: async () => ({ data: failed, error: null }) };
  return builder;
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));

const { default: PipelinePage } = await import("@/app/(app)/w/[workspaceSlug]/pipelines/[pipelineId]/page");
const page = () => PipelinePage({ params: Promise.resolve({ workspaceSlug: "histoire", pipelineId: PIPELINE_ID }) } as never);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_EMAILS", "ops@pipeline.test");
});
afterEach(() => vi.unstubAllEnvs());

describe("page d'un pipeline : diagnostic des erreurs", () => {
  it("montre le message exact du fournisseur à un administrateur de la plateforme", async () => {
    user = { id: "admin-1", email: "ops@pipeline.test" };
    render(await page());
    const diagnostics = screen.getByRole("region", { name: "Diagnostic (administrateur)" });
    expect(within(diagnostics).getByText("401 Incorrect API key provided.")).toBeInTheDocument();
    expect(within(diagnostics).getByText("PROVIDER_ERROR")).toBeInTheDocument();
    expect(eq).toHaveBeenCalledWith("pipeline_id", PIPELINE_ID);
  });

  it("ne lit ni n'affiche rien pour un membre qui n'est pas administrateur", async () => {
    user = { id: "user-1", email: "membre@test.local" };
    render(await page());
    expect(screen.queryByRole("region", { name: "Diagnostic (administrateur)" })).not.toBeInTheDocument();
    expect(screen.queryByText("401 Incorrect API key provided.")).not.toBeInTheDocument();
    expect(from).not.toHaveBeenCalled();
  });
});
