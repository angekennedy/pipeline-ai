// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { generateMetadata } from "@/app/mentions-legales/page";
import { LegalDocument } from "@/components/legal/legal-document";
import { SiteFooter } from "@/components/site-footer";
import { isLegalComplete, LEGAL_ENTITY, type LegalEntity } from "@/lib/legal";

// Documents légaux (tâche 5.2), avec les vrais messages français.
const complete: LegalEntity = {
  publisher: "Pipeline AI SAS",
  legalForm: "SAS au capital de 1 000 €",
  address: "1 rue de l'Exemple, 75001 Paris",
  registration: "RCS Paris 000 000 000, TVA FR00000000000",
  director: "Ada Lovelace",
  email: "contact@pipeline.test",
  jurisdiction: "droit français, tribunaux de Paris",
  mediator: "Médiateur Exemple, mediateur.test",
  databaseRegion: "Europe (Francfort)",
  errorRetention: "90 jours",
};

describe("documents légaux", () => {
  it("signale un document provisoire et chaque information manquante, tant que l'éditeur n'est pas renseigné", async () => {
    expect(isLegalComplete(LEGAL_ENTITY)).toBe(false);
    render(await LegalDocument({ page: "notice" }));
    expect(screen.getByRole("heading", { level: 1, name: "Mentions légales" })).toBeInTheDocument();
    expect(await generateMetadata()).toEqual({ title: "Mentions légales · Pipeline AI", alternates: { canonical: "/mentions-legales" } });
    expect(screen.getByRole("note")).toHaveTextContent("Document provisoire");
    expect(screen.getByText(/^\[à compléter : raison sociale de l'éditeur\], \[à compléter : forme juridique et capital\]\.$/)).toBeInTheDocument();
    expect(screen.getByText("Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, USA.")).toBeInTheDocument();
  });

  it("insère l'identité de l'éditeur et retire le bandeau une fois tout renseigné", async () => {
    expect(isLegalComplete(complete)).toBe(true);
    render(await LegalDocument({ page: "privacy", entity: complete }));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText(/à compléter/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Le responsable du traitement est Pipeline AI SAS, 1 rue de l'Exemple, 75001 Paris\./)).toBeInTheDocument();
    expect(screen.getByText(/hébergées dans la région Europe \(Francfort\)/)).toBeInTheDocument();
  });

  it("rend les listes et un sommaire qui mène à chaque section", async () => {
    render(await LegalDocument({ page: "privacy", entity: complete }));
    const toc = screen.getByRole("navigation", { name: "Sommaire" });
    const links = within(toc).getAllByRole("link");
    expect(links[0]).toHaveTextContent("Responsable du traitement");
    expect(links[0]).toHaveAttribute("href", "#controller");
    const processors = screen.getByRole("region", { name: "Sous-traitants" });
    expect(within(processors).getAllByRole("listitem").map((item) => item.textContent?.split(" :")[0])).toEqual(["Supabase", "Anthropic", "Stripe", "Vercel", "Inngest", "Sentry"]);
  });

  it("présente les sujets refusés de la charte, alignés sur la modération", async () => {
    render(await LegalDocument({ page: "usage", entity: complete }));
    const refused = within(screen.getByRole("region", { name: "Sujets refusés" })).getAllByRole("listitem");
    expect(refused.map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^désinformation médicale :/),
      "contenus sexuels ou pornographiques ;",
      expect.stringMatching(/^extrémisme :/),
    ]);
  });

  it("relie les quatre documents depuis le pied de page", () => {
    render(<SiteFooter />);
    const links = within(screen.getByRole("navigation", { name: "Informations légales" })).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["CGU", "/cgu"],
      ["Confidentialité", "/confidentialite"],
      ["Charte d'usage", "/charte"],
      ["Mentions légales", "/mentions-legales"],
    ]);
  });
});
