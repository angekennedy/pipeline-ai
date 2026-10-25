// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PricingPage from "@/app/pricing/page";

describe("page des tarifs", () => {
  it("présente les quatre plans avec leurs crédits", () => {
    render(<PricingPage />);
    const plans = within(screen.getByRole("list", { name: "Plans" })).getAllByRole("heading", { level: 2 });
    expect(plans.map((h) => h.textContent)).toEqual(["Free", "Creator", "Pro", "Studio"]);
    expect(screen.getByText("30 crédits offerts")).toBeInTheDocument();
    expect(screen.getByText(/^1.500 crédits par mois$/)).toBeInTheDocument(); // séparateur de milliers : espace fine insécable
    expect(screen.getByText("Environ 71 vidéos de 10 min")).toBeInTheDocument(); // Pro : 1 500 / 21
    expect(screen.getByRole("link", { name: "Commencer" })).toHaveAttribute("href", "/pipelines/new");
  });

  it("explique le coût de chaque asset, avec des exemples tirés de la grille", () => {
    render(<PricingPage />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.lastElementChild?.textContent)).toEqual(["14", "1", "2", "3", "1"]);
    expect(screen.getByText(/Vidéo de 10 min, Standard/)).toHaveTextContent("21 crédits");
    expect(screen.getByText(/Vidéo de 10 min, Premium/)).toHaveTextContent("35 crédits");
    expect(screen.getByText(/Vidéo de 30 min, Standard/)).toHaveTextContent("43 crédits");
  });

  it("propose les packs ponctuels", () => {
    render(<PricingPage />);
    const packs = within(screen.getByRole("region", { name: "Packs de crédits" })).getAllByRole("listitem");
    expect(packs.map((p) => p.textContent)).toEqual(["200 crédits15 €", "1 000 crédits59 €"]);
  });
});
