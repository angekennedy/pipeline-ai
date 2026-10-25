// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CopyButton } from "@/components/pipeline/copy-button";

describe("CopyButton", () => {
  it("copie le texte et l'annonce", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<CopyButton text="Le script complet" label="Copier le script" />);

    await user.click(screen.getByRole("button", { name: /Copier le script/ }));
    expect(writeText).toHaveBeenCalledWith("Le script complet");
    expect(await screen.findByText("Copié dans le presse-papiers")).toBeInTheDocument();
  });

  it("signale un échec de copie (permission refusée)", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    render(<CopyButton text="x" label="Copier" />);

    await user.click(screen.getByRole("button", { name: /Copier/ }));
    expect(await screen.findByText("La copie a échoué")).toBeInTheDocument();
  });
});
