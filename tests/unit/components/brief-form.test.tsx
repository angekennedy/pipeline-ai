// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BriefForm } from "@/components/pipeline/brief-form";
import { creditSummary } from "@/lib/billing/balance";
import { BRIEF_FIELD_MESSAGES } from "@/lib/pipeline/brief-form";

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
      fieldErrors: { niche: BRIEF_FIELD_MESSAGES.niche },
      values: { niche: "H", topic: "Les pyramides de Gizeh" },
    });
    render(<BriefForm workspaceSlug="mon-espace" idempotencyKey={KEY} credits={credits} />);
    await user.click(screen.getByRole("button", { name: "Générer le pipeline" }));

    const niche = await screen.findByLabelText("Niche");
    expect(niche).toHaveAttribute("aria-invalid", "true");
    expect(niche).toHaveAccessibleDescription(expect.stringContaining(BRIEF_FIELD_MESSAGES.niche));
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
    expect(within(dialog).getByRole("link", { name: "Voir les tarifs" })).toHaveAttribute("href", "/pricing");
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
