// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "@/app/page";

describe("page d'accueil", () => {
  it("affiche le nom du produit et l'appel à l'action", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1, name: "Pipeline AI" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Créer un pipeline" })).toHaveAttribute("href", "/pipelines/new");
  });

  it("donne accès aux démonstrations", () => {
    render(<Home />);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/pipelines/demo-running", "/pipelines/demo-completed", "/pipelines/demo-partial", "/pipelines/demo-failed", "/pipelines/demo-stale"]));
  });
});
