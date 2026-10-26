// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteAccountForm, ProfileForm } from "@/components/settings/settings-forms";

const deleteAccountAction = vi.fn();
const updateProfile = vi.fn();
vi.mock("@/app/(app)/settings/actions", () => ({
  deleteAccountAction: (...args: unknown[]) => deleteAccountAction(...args),
  updateProfile: (...args: unknown[]) => updateProfile(...args),
  renameWorkspace: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DeleteAccountForm", () => {
  it("n'active la suppression qu'une fois l'adresse e-mail retapée", async () => {
    const user = userEvent.setup();
    deleteAccountAction.mockResolvedValue({});
    render(<DeleteAccountForm email="ada@test.local" />);
    const button = screen.getByRole("button", { name: "Supprimer définitivement mon compte" });
    expect(button).toBeDisabled();

    const input = screen.getByLabelText(/saisissez votre adresse e-mail/);
    await user.type(input, "ada@test.loca");
    expect(button).toBeDisabled();
    await user.type(input, "l");
    expect(button).toBeEnabled();

    await user.click(button);
    expect((deleteAccountAction.mock.calls[0]![1] as FormData).get("confirmation")).toBe("ada@test.local");
  });

  it("affiche le refus renvoyé par la Server Action", async () => {
    const user = userEvent.setup();
    deleteAccountAction.mockResolvedValue({ error: "workspaceShared", workspaces: "Équipe" });
    render(<DeleteAccountForm email="ada@test.local" />);
    await user.type(screen.getByLabelText(/saisissez votre adresse e-mail/), "ADA@test.local");
    await user.click(screen.getByRole("button", { name: "Supprimer définitivement mon compte" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Vous êtes le seul propriétaire de Équipe, qui a d'autres membres.");
  });
});

describe("ProfileForm", () => {
  it("confirme l'enregistrement du nom affiché", async () => {
    const user = userEvent.setup();
    updateProfile.mockResolvedValue({ saved: true });
    render(<ProfileForm displayName="Ada" />);
    expect(screen.getByLabelText("Nom affiché")).toHaveValue("Ada");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Profil enregistré.")).toBeInTheDocument();
  });
});
