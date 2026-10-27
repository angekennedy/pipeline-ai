// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { generateMetadata } from "@/app/mentions-legales/page";
import { LegalDocument } from "@/components/legal/legal-document";
import { SiteFooter } from "@/components/site-footer";
import { isLegalComplete, type LegalEntity } from "@/lib/legal";

// Documents légaux (tâche 5.2), avec les vrais messages français.
const complete: LegalEntity = {
  publisher: "Exemple Inc.",
  address: "1, rue de l'Exemple, Montréal (Québec) H2X 1Y1",
  registration: "1100000000",
  taxNumbers: "TPS 000000000 RT0001, TVQ 0000000000 TQ0001",
  phone: "514 555-0100",
  privacyOfficer: "Ada Lovelace",
  email: "contact@pipeline.test",
};

describe("documents légaux", () => {
  it("signale un document provisoire et chaque information manquante, tant que l'éditeur n'est pas renseigné", async () => {
    const partial = { ...complete, taxNumbers: null, phone: null };
    expect(isLegalComplete(partial)).toBe(false);
    render(await LegalDocument({ page: "notice", entity: partial }));
    expect(screen.getByRole("heading", { level: 1, name: "Mentions légales" })).toBeInTheDocument();
    expect(await generateMetadata()).toEqual({ title: "Mentions légales · Pipeline AI", alternates: { canonical: "/mentions-legales" } });
    expect(screen.getByRole("note")).toHaveTextContent("Document provisoire");
    expect(screen.getByText("Numéros de TPS et de TVQ : [à compléter : numéros de TPS et de TVQ].")).toBeInTheDocument();
    expect(screen.getByText("Contact : contact@pipeline.test, [à compléter : numéro de téléphone].")).toBeInTheDocument();
    expect(screen.getByText("Exemple Inc., société par actions.")).toBeInTheDocument();
    expect(screen.getByText("Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, USA.")).toBeInTheDocument();
  });

  it("insère l'identité de l'éditeur et retire le bandeau une fois tout renseigné", async () => {
    expect(isLegalComplete(complete)).toBe(true);
    render(await LegalDocument({ page: "privacy", entity: complete }));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText(/à compléter/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Exemple Inc\., 1, rue de l'Exemple, Montréal \(Québec\) H2X 1Y1, est responsable des renseignements personnels/)).toBeInTheDocument();
    expect(screen.getByText(/^La personne responsable de la protection des renseignements personnels est Ada Lovelace\./)).toBeInTheDocument();
    expect(screen.getByText(/Commission d'accès à l'information du Québec/)).toBeInTheDocument();
  });

  it("rend les listes et un sommaire qui mène à chaque section", async () => {
    render(await LegalDocument({ page: "privacy", entity: complete }));
    const toc = screen.getByRole("navigation", { name: "Sommaire" });
    const links = within(toc).getAllByRole("link");
    expect(links[0]).toHaveTextContent("Responsable des renseignements personnels");
    expect(links[0]).toHaveAttribute("href", "#controller");
    const processors = screen.getByRole("region", { name: "Prestataires et communication hors du Québec" });
    expect(within(processors).getAllByRole("listitem").map((item) => item.textContent?.split(" :")[0])).toEqual(["Supabase", "OpenAI", "Stripe", "Vercel", "Inngest", "Sentry", "PostHog"]);
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
