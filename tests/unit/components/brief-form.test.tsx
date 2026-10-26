// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BriefForm } from "@/components/pipeline/brief-form";
import { creditSummary } from "@/lib/billing/balance";

const credits = creditSummary("free", 30);
const studio = creditSummary("studio", 5000);
const KEY = "8b0b2e2a-6f3e-4e0e-9a51-2a8f4c1d9e70";

const createPipeline = vi.fn();
vi.mock("@/app/(app)/w/[workspaceSlug]/pipelines/new/actions", () => ({ createPipeline: (...args: unknown[]) => createPipeline(...args) }));

beforeEach(() => {
  createPipeline.mockReset();
});

describe("BriefForm", () => {
  it("propose tous les champs du brief avec des valeurs par défaut", () => {
    render(<BriefForm workspaceSlug="mon-espace" idempotencyKey={KEY} credits={credits} />);
    expect(screen.getByLabelText("Niche")).toBeRequired();
    expect(screen.getByLabelText("Sujet de la vidéo")).toBeRequired();
    expect(screen.getByLabelText("Durée cible (minutes)")).toHaveValue(8);
    expect(screen.getByLabelText("Langue")).toHaveValue("fr");
    expect(screen.getByLabelText("Ton")).toHaveValue("educational");
    expect(screen.getByLabelText("Style")).toHaveValue("documentary");
    expect(screen.getByLabelText(/Standard/)).toBeChecked();
  });

  it("préremplit le formulaire avec un brief dupliqué, et son coût", () => {
    const values = {
      niche: "Histoire",
      topic: "Les pyramides de Gizeh",
      language: "en",
      tone: "mysterious",
      style: "storytelling",
      durationMinutes: "10",
      targetAudience: "Curieux",
      extraNotes: "Citer Hérodote",
      tier: "premium",
    };
    render(<BriefForm workspaceSlug="mon-espace" idempotencyKey={KEY} credits={studio} initialValues={values} />);
    expect(screen.getByLabelText("Niche")).toHaveValue("Histoire");
    expect(screen.getByLabelText("Sujet de la vidéo")).toHaveValue("Les pyramides de Gizeh");
    expect(screen.getByLabelText("Durée cible (minutes)")).toHaveValue(10);
    expect(screen.getByLabelText("Langue")).toHaveValue("en");
    expect(screen.getByLabelText("Ton")).toHaveValue("mysterious");
    expect(screen.getByLabelText("Style")).toHaveValue("storytelling");
    expect(screen.getByLabelText("Public visé (facultatif)")).toHaveValue("Curieux");
    expect(screen.getByLabelText("Consignes supplémentaires (facultatif)")).toHaveValue("Citer Hérodote");
    expect(screen.getByLabelText(/Premium/)).toBeChecked();
    expect(screen.getAllByText(/35 crédits/).length).toBeGreaterThan(0); // Premium 10 min : script 28, titres 1, SEO 2, voix off 3, miniatures 1
  });

  it("repasse en Standard un brief Premium dupliqué sur un plan qui ne l'inclut pas", () => {
    render(<BriefForm workspaceSlug="mon-espace" idempotencyKey={KEY} credits={credits} initialValues={{ niche: "Histoire", tier: "premium" }} />);
    expect(screen.getByLabelText(/Premium/)).toBeDisabled();
    expect(screen.getByLabelText(/Premium/)).not.toBeChecked();
    expect(screen.getByLabelText(/Standard/)).toBeChecked();
  });

  it("préremplit le brief avec le preset choisi et l'envoie avec", async () => {
    const user = userEvent.setup();
    createPipeline.mockResolvedValue({ fieldErrors: {}, values: {} });
    const channels = [
      { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Mystères d'Égypte", niche: "Histoire", defaultLanguage: "en" as const, tone: "mysterious" as const, audience: "Curieux" },
      { id: "2c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Sciences", niche: "Science", defaultLanguage: "fr" as const },
    ];
    render(<BriefForm workspaceSlug="mon-espace" idempotencyKey={KEY} credits={credits} channels={channels} />);
    await user.selectOptions(screen.getByLabelText("Ton"), "humorous");
    await user.selectOptions(screen.getByLabelText("Style"), "listicle");

    await user.selectOptions(screen.getByLabelText("Preset de chaîne"), "Mystères d'Égypte");
    expect(screen.getByLabelText("Niche")).toHaveValue("Histoire");
    expect(screen.getByLabelText("Langue")).toHaveValue("en");
    expect(screen.getByLabelText("Ton")).toHaveValue("mysterious");
    expect(screen.getByLabelText("Style")).toHaveValue("listicle"); // le preset ne fixe pas de style : saisie gardée
    expect(screen.getByLabelText("Public visé (facultatif)")).toHaveValue("Curieux");

    await user.type(screen.getByLabelText("Sujet de la vidéo"), "Les pyramides");
    await user.click(screen.getByRole("button", { name: "Générer le pipeline" }));
    const data = createPipeline.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(data)).toMatchObject({ channelId: channels[0]!.id, niche: "Histoire", language: "en", tone: "mysterious" });
  });

  it("propose de créer un preset quand le workspace n'en a aucun", () => {
    render(<BriefForm workspaceSlug="mon-espace" idempotencyKey={KEY} credits={credits} />);
    expect(screen.queryByLabelText("Preset de chaîne")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Créez un preset de chaîne" })).toHaveAttribute("href", "/w/mon-espace/channels/new");
  });

  it("envoie la saisie à la Server Action", async () => {
    const user = userEvent.setup();
    createPipeline.mockResolvedValue({ fieldErrors: {}, values: {} });
    render(<BriefForm workspaceSlug="mon-espace" idempotencyKey={KEY} credits={studio} />);

    await user.type(screen.getByLabelText("Niche"), "Histoire");
    await user.type(screen.getByLabelText("Sujet de la vidéo"), "Les pyramides");
    await user.click(screen.getByLabelText(/Premium/));
    await user.click(screen.getByRole("button", { name: "Générer le pipeline" }));

    expect(createPipeline).toHaveBeenCalledTimes(1);
    const data = createPipeline.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(data)).toMatchObject({ niche: "Histoire", topic: "Les pyramides", durationMinutes: "8", tier: "premium", workspaceSlug: "mon-espace", idempotencyKey: KEY });
  });

  it("affiche les erreurs par champ et garde la saisie", async () => {
    const user = userEvent.setup();
    createPipeline.mockResolvedValue({
      fieldErrors: { niche: true },
      values: { niche: "H", topic: "Les pyramides de Gizeh" },
    });
    render(<BriefForm workspaceSlug="mon-espace" idempotencyKey={KEY} credits={credits} />);
    await user.click(screen.getByRole("button", { name: "Générer le pipeline" }));

    await screen.findByText("Corrigez les champs signalés."); // état renvoyé par l'action, appliqué
    const niche = screen.getByLabelText("Niche");
    expect(niche).toHaveAttribute("aria-invalid", "true");
    expect(niche).toHaveAccessibleDescription(expect.stringContaining("Indiquez la niche de la chaîne"));
    expect(screen.getByLabelText("Sujet de la vidéo")).toHaveValue("Les pyramides de Gizeh");
    expect(screen.getByText("Corrigez les champs signalés.")).toBeInTheDocument();
  });

  it("affiche le coût avant le lancement et le recalcule selon la durée et la formule", async () => {
    const user = userEvent.setup();
    render(<BriefForm workspaceSlug="mon-espace" idempotencyKey={KEY} credits={creditSummary("studio", 30)} />);
    const estimate = screen.getByRole("region", { name: /Coût/ });
    expect(estimate).toHaveTextContent("Coût : 18 crédits"); // 8 min en Standard
    expect(estimate).toHaveTextContent("Solde après le lancement : 12 crédits.");

    const duration = screen.getByLabelText("Durée cible (minutes)");
    await user.clear(duration);
    await user.type(duration, "10");
    await user.click(screen.getByLabelText(/Premium/));
    const updated = screen.getByRole("region", { name: /Coût/ });
    expect(updated).toHaveTextContent("Coût : 35 crédits");
    expect(updated).toHaveTextContent("Il vous manque 5 crédits (30 crédits disponibles).");
  });

  it("masque le coût tant que la durée est invalide", async () => {
    const user = userEvent.setup();
    render(<BriefForm workspaceSlug="mon-espace" idempotencyKey={KEY} credits={credits} />);
    await user.clear(screen.getByLabelText("Durée cible (minutes)"));
    expect(screen.queryByRole("region", { name: /Coût/ })).not.toBeInTheDocument();
  });

  it("ouvre le modal « crédits insuffisants » quand la réservation échoue", async () => {
    const user = userEvent.setup();
    createPipeline.mockResolvedValue({
      fieldErrors: {},
      values: { niche: "Histoire", topic: "Les pyramides", durationMinutes: "10", tier: "premium" },
      insufficient: { required: 35, available: 30 },
    });
    render(<BriefForm workspaceSlug="mon-espace" idempotencyKey={KEY} credits={creditSummary("studio", 30)} />);
    await user.click(screen.getByRole("button", { name: "Générer le pipeline" }));

    const dialog = await screen.findByRole("dialog", { name: "Crédits insuffisants" });
    expect(dialog).toHaveTextContent("Ce pipeline coûte 35 crédits et vous en avez 30 disponibles : il en manque 5.");
    expect(within(dialog).getByRole("link", { name: "Acheter des crédits" })).toHaveAttribute("href", "/billing");
    // La saisie est conservée pour ajuster le brief.
    expect(screen.getByLabelText("Durée cible (minutes)")).toHaveValue(10);
    expect(screen.getByLabelText(/Premium/)).toBeChecked();

    await user.click(within(dialog).getByRole("button", { name: "Modifier le brief" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("annonce les limites du plan : durée maximale, Premium grisé hors Studio", () => {
    render(<BriefForm workspaceSlug="mon-espace" idempotencyKey={KEY} credits={credits} />);
    const duration = screen.getByLabelText("Durée cible (minutes)");
    expect(duration).toHaveAttribute("max", "10");
    expect(duration).toHaveAccessibleDescription("Jusqu'à 10 min avec le plan Free.");
    expect(screen.getByLabelText(/Premium/)).toBeDisabled();
    expect(screen.getByText("(inclus dans le plan Studio)")).toBeInTheDocument();
  });

  it("affiche le refus du plan avec son message et un lien vers les tarifs", async () => {
    const user = userEvent.setup();
    createPipeline.mockResolvedValue({
      fieldErrors: {},
      values: { niche: "Histoire", topic: "Les pyramides", durationMinutes: "15" },
      restriction: { reason: "duration", plan: "free", limit: 10 },
    });
    render(<BriefForm workspaceSlug="mon-espace" idempotencyKey={KEY} credits={credits} />);
    await user.click(screen.getByRole("button", { name: "Générer le pipeline" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Le plan Free limite les vidéos à 10 min. Réduisez la durée, ou passez au plan Creator pour aller jusqu'à 60 min.");
    expect(within(alert).getByRole("link", { name: "Voir les tarifs" })).toHaveAttribute("href", "/pricing");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
