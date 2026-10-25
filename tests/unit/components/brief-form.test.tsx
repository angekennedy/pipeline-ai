// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BriefForm } from "@/components/pipeline/brief-form";
import { BRIEF_FIELD_MESSAGES } from "@/lib/pipeline/brief-form";

const createPipeline = vi.fn();
vi.mock("@/app/pipelines/new/actions", () => ({ createPipeline: (...args: unknown[]) => createPipeline(...args) }));

beforeEach(() => {
  createPipeline.mockReset();
});

describe("BriefForm", () => {
  it("propose tous les champs du brief avec des valeurs par défaut", () => {
    render(<BriefForm />);
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
    render(<BriefForm />);

    await user.type(screen.getByLabelText("Niche"), "Histoire");
    await user.type(screen.getByLabelText("Sujet de la vidéo"), "Les pyramides");
    await user.click(screen.getByLabelText(/Premium/));
    await user.click(screen.getByRole("button", { name: "Générer le pipeline" }));

    expect(createPipeline).toHaveBeenCalledTimes(1);
    const data = createPipeline.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(data)).toMatchObject({ niche: "Histoire", topic: "Les pyramides", durationMinutes: "8", tier: "premium" });
  });

  it("affiche les erreurs par champ et garde la saisie", async () => {
    const user = userEvent.setup();
    createPipeline.mockResolvedValue({
      fieldErrors: { niche: BRIEF_FIELD_MESSAGES.niche },
      values: { niche: "H", topic: "Les pyramides de Gizeh" },
    });
    render(<BriefForm />);
    await user.click(screen.getByRole("button", { name: "Générer le pipeline" }));

    const niche = await screen.findByLabelText("Niche");
    expect(niche).toHaveAttribute("aria-invalid", "true");
    expect(niche).toHaveAccessibleDescription(expect.stringContaining(BRIEF_FIELD_MESSAGES.niche));
    expect(screen.getByLabelText("Sujet de la vidéo")).toHaveValue("Les pyramides de Gizeh");
    expect(screen.getByText("Corrigez les champs signalés.")).toBeInTheDocument();
  });
});
