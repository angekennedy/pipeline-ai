// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "@/app/page";

// Landing (tâche 5.1), en français (tests/setup.ts : getLocale renvoie « fr »).
describe("page d'accueil", () => {
  it("annonce la promesse, l'appel à l'action et les crédits offerts", async () => {
    render(await Home());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tout ce qu'il faut pour une vidéo YouTube faceless");
    expect(screen.getByRole("link", { name: "Créer un pipeline" })).toHaveAttribute("href", "/pipelines/new");
    expect(screen.getByRole("link", { name: "Voir un exemple réel" })).toHaveAttribute("href", "/pipelines/demo-rome");
    expect(screen.getByText("30 crédits offerts à l'inscription, sans carte bancaire.")).toBeInTheDocument();
  });

  it("montre l'exemple réel dans la langue de l'interface, avec son coût mesuré", async () => {
    render(await Home());
    const example = screen.getByRole("region", { name: "Un exemple réel, sans retouche" });
    expect(example).toHaveTextContent("Brief : « Pourquoi l'Empire romain d'Occident s'est-il effondré en 476 ? », 8 min, niche Histoire.");
    expect(within(example).getByText(/^Généré|scènes/)).toHaveTextContent(/\d+ scènes, \d+ titres, \d+ chapitres\. Généré en 168 s, pour 0,22\s\$US de calcul\./);
    expect(within(example).getByRole("link", { name: "Ouvrir le pipeline complet" })).toHaveAttribute("href", "/pipelines/demo-rome");
  });

  it("présente les cinq livrables, les étapes, les tarifs et la FAQ avec ses données structurées", async () => {
    const { container } = render(await Home());
    const assets = within(screen.getByRole("region", { name: "Cinq livrables par vidéo" })).getAllByRole("heading", { level: 3 });
    expect(assets.map((h) => h.textContent)).toEqual(["Script", "Titres", "SEO", "Voix off", "Miniatures"]);
    expect(screen.getByText(/21 crédits pour une vidéo de 10 min en Standard/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voir les tarifs" })).toHaveAttribute("href", "/pricing");

    const questions = within(screen.getByRole("region", { name: "Questions fréquentes" })).getAllByText(/\?$/);
    expect(questions).toHaveLength(6);
    const jsonLd = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(jsonLd).toMatchObject({ "@type": "FAQPage" });
    expect(jsonLd.mainEntity).toHaveLength(6);
    expect(jsonLd.mainEntity[0]).toMatchObject({ "@type": "Question", name: "Qu'est-ce qu'une chaîne faceless ?", acceptedAnswer: { "@type": "Answer" } });
  });

  it("donne toujours accès aux démonstrations des états d'un pipeline", async () => {
    render(await Home());
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/pipelines/demo-running", "/pipelines/demo-completed", "/pipelines/demo-partial", "/pipelines/demo-failed", "/pipelines/demo-stale"]));
  });
});
