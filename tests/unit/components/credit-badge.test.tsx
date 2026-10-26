// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CreditBadge } from "@/components/billing/credit-badge";
import { creditSummary } from "@/lib/billing/balance";

describe("CreditBadge", () => {
  it("affiche le disponible, hors crédits réservés, et mène aux tarifs", () => {
    render(<CreditBadge credits={creditSummary("creator", 400, 21)} />);
    const link = screen.getByRole("link", { name: "379 crédits disponibles, plan Creator. Facturation et crédits" });
    expect(link).toHaveAttribute("href", "/billing");
    expect(link).toHaveAttribute("title", "21 crédits réservés par les pipelines en cours");
  });
});
