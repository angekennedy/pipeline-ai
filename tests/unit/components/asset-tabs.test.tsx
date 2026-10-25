// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AssetTabs } from "@/components/pipeline/asset-tabs";
import type { Brief, Scene } from "@/lib/ai/schemas";
import { demoPipeline } from "@/lib/demo/pipelines";
import { emptyPipelineView, type PipelineView } from "@/lib/pipeline/view";
import { validBrief, validScript } from "../../fixtures/assets";

const view = (id: string) => demoPipeline(id)!.view;
const pending = () => emptyPipelineView({ id: "p1", brief: validBrief as Brief, tier: "standard", createdAt: "2026-10-24T10:00:00Z" });

async function openTab(name: RegExp) {
  await userEvent.setup().click(screen.getByRole("tab", { name }));
  return screen.getByRole("tabpanel");
}

describe("AssetTabs", () => {
  it("affiche un onglet par asset, avec son statut pour les lecteurs d'écran", () => {
    render(<AssetTabs view={view("demo-partial")} scenes={[]} />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Script(prêt)",
      "Titres(prêt)",
      "SEO(échec)",
      "Voix off(prêt)",
      "Miniatures(prêt)",
    ]);
  });

  it("ouvre le script terminé, avec ses scènes horodatées et ses boutons de copie", () => {
    render(<AssetTabs view={view("demo-completed")} scenes={[]} />);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("heading", { name: "Le chantier impossible de Gizeh" })).toBeInTheDocument();
    expect(within(panel).getAllByRole("listitem").length).toBeGreaterThanOrEqual(8);
    expect(within(panel).getByText("00:00")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Copier le script/ })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Copier la narration/ })).toBeInTheDocument();
    expect(within(panel).getByText(/Points à vérifier/)).toBeInTheDocument();
  });

  it("affiche chaque asset dérivé terminé", async () => {
    render(<AssetTabs view={view("demo-completed")} scenes={[]} />);
    expect(within(await openTab(/Titres/)).getByText("Recommandé")).toBeInTheDocument();
    expect(within(await openTab(/SEO/)).getByRole("button", { name: /Copier les tags/ })).toBeInTheDocument();
    expect(within(await openTab(/Voix off/)).getByText(/Narrateur documentaire/)).toBeInTheDocument();
    expect(within(await openTab(/Miniatures/)).getByText(/Pour « Pyramides : le chantier/)).toBeInTheDocument();
  });

  it("état partiel : l'asset en échec affiche son message et son code", async () => {
    render(<AssetTabs view={view("demo-partial")} scenes={[]} />);
    const alert = within(await openTab(/SEO/)).getByRole("alert");
    expect(alert).toHaveTextContent("Échec de la génération");
    expect(alert).toHaveTextContent("CONTENT_REFUSED");
    expect(within(alert).getByRole("button", { name: /Régénérer/ })).toBeDisabled();
  });

  it("état d'échec : les dérivés expliquent pourquoi ils n'ont pas été générés", async () => {
    render(<AssetTabs view={view("demo-failed")} scenes={[]} />);
    expect(within(screen.getByRole("tabpanel")).getByRole("alert")).toHaveTextContent("surchargé");
    expect(await openTab(/Miniatures/)).toHaveTextContent("Non généré : le script ou les titres n'ont pas abouti.");
  });

  it("état vide : chaque asset dit ce qu'il attend", async () => {
    render(<AssetTabs view={pending()} scenes={[]} />);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Le script démarre dès que le pipeline est pris en charge.");
    expect(await openTab(/Miniatures/)).toHaveTextContent("Les miniatures démarrent dès que les titres sont prêts.");
  });

  it("chargement : le script en cours affiche les scènes déjà reçues, puis un emplacement", () => {
    const running: PipelineView = { ...pending(), status: "running", assets: { ...pending().assets, script: { status: "running", content: null, error: null } } };
    render(<AssetTabs view={running} scenes={validScript.scenes.slice(0, 2) as Scene[]} />);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("1. Le bloc impossible")).toBeInTheDocument();
    expect(within(panel).getByText("Écriture de la scène 3…")).toBeInTheDocument();
    expect(within(panel).queryByText("00:00")).not.toBeInTheDocument(); // durées pas encore recalculées
  });

  it("chargement : un dérivé en cours affiche un squelette", async () => {
    const running: PipelineView = { ...pending(), assets: { ...pending().assets, seo: { status: "running", content: null, error: null } } };
    render(<AssetTabs view={running} scenes={[]} />);
    expect(within(await openTab(/SEO/)).getByRole("status")).toHaveTextContent("Génération : seo…");
  });
});
