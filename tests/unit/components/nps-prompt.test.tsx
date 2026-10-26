// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NpsPrompt } from "@/components/nps-prompt";

const submitNps = vi.fn();
const dismissNps = vi.fn();
vi.mock("@/app/(app)/nps-actions", () => ({
  submitNps: (...args: unknown[]) => submitNps(...args),
  dismissNps: (...args: unknown[]) => dismissNps(...args),
}));

beforeEach(() => vi.clearAllMocks());

describe("NpsPrompt", () => {
  it("propose les notes de 0 à 10, envoie la note et le commentaire, puis remercie", async () => {
    const user = userEvent.setup();
    submitNps.mockResolvedValue({ sent: true });
    render(<NpsPrompt />);
    const scale = screen.getByRole("group", { name: /Quelle est la probabilité/ });
    expect(within(scale).getAllByRole("radio")).toHaveLength(11);

    await user.click(within(scale).getByRole("radio", { name: "8" }));
    await user.type(screen.getByLabelText(/meilleure note/), "Des voix off plus naturelles");
    await user.click(screen.getByRole("button", { name: "Envoyer" }));

    const data = submitNps.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(data)).toEqual({ score: "8", comment: "Des voix off plus naturelles" });
    expect(await screen.findByRole("status")).toHaveTextContent("Merci : votre réponse aide à améliorer Pipeline AI.");
  });

  it("permet de remettre la question à plus tard, sans note", async () => {
    const user = userEvent.setup();
    render(<NpsPrompt />);
    await user.click(screen.getByRole("button", { name: "Plus tard" }));
    await vi.waitFor(() => expect(dismissNps).toHaveBeenCalledOnce()); // action de formulaire, asynchrone
    expect(submitNps).not.toHaveBeenCalled();
  });
});
