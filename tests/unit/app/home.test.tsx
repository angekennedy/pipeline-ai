// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "@/app/page";

describe("page d'accueil", () => {
  it("affiche le nom du produit et l'appel à l'action", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1, name: "Pipeline AI" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bientôt disponible" })).toBeDisabled();
  });
});
