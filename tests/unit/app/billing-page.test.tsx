// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { creditSummary } from "@/lib/billing/balance";

// Page Facturation : rappel des documents légaux au moment de payer (tâche 5.2). Le reste de la page
// est couvert par l'e2e (tests/e2e/billing.spec.ts), sans paiement en ligne.

vi.mock("@/lib/workspaces/access", () => ({
  requireMembership: async () => ({ workspace: { id: "ws-1", slug: "mon-espace", name: "Mon espace" }, role: "owner", credits: creditSummary("free", 30) }),
  hasRole: () => true,
}));
let enabled = true;
vi.mock("@/lib/billing/stripe", async (original) => ({ ...(await original<typeof import("@/lib/billing/stripe")>()), billingEnabled: () => enabled }));
vi.mock("@/app/(app)/w/[workspaceSlug]/billing/actions", () => ({ startCheckout: vi.fn(), openPortal: vi.fn() }));
const empty = { data: [], error: null };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: async () => empty,
        single: async () => ({ data: { stripe_customer_id: null }, error: null }),
        then: (resolve: (value: unknown) => void) => resolve(empty), // requête attendue telle quelle
      };
      return builder;
    },
  }),
}));

const { default: BillingPage } = await import("@/app/(app)/w/[workspaceSlug]/billing/page");
const page = () => BillingPage({ params: Promise.resolve({ workspaceSlug: "mon-espace" }), searchParams: Promise.resolve({}) } as never);

beforeEach(() => {
  enabled = true;
});

describe("page Facturation", () => {
  it("rappelle les CGU et la politique de confidentialité sous les offres payantes", async () => {
    render(await page());
    const consent = screen.getByText(/^En passant au paiement, vous acceptez les/);
    expect(screen.getByRole("link", { name: "conditions générales d'utilisation et de vente" })).toHaveAttribute("href", "/cgu");
    expect(screen.getByRole("link", { name: "politique de confidentialité" })).toHaveAttribute("href", "/confidentialite");
    expect(consent).toBeVisible();
  });

  it("n'affiche pas le rappel sans paiement en ligne", async () => {
    enabled = false;
    render(await page());
    expect(screen.queryByText(/En passant au paiement/)).not.toBeInTheDocument();
  });
});
