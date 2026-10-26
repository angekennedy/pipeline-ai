// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/auth/login-form";

const sendMagicLink = vi.fn();
vi.mock("@/app/(auth)/login/actions", () => ({
  sendMagicLink: (...args: unknown[]) => sendMagicLink(...args),
  signInWithGoogle: vi.fn(),
}));
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => search }));

beforeEach(() => {
  sendMagicLink.mockReset();
  search = new URLSearchParams();
});

describe("LoginForm", () => {
  it("envoie l'adresse et la destination, puis annonce l'envoi du lien", async () => {
    search = new URLSearchParams("next=/pipelines/new");
    sendMagicLink.mockResolvedValue({ status: "sent", email: "a@test.local" });
    const user = userEvent.setup();
    render(<LoginForm googleEnabled={false} />);

    await user.type(screen.getByLabelText("Adresse e-mail"), "a@test.local");
    await user.click(screen.getByRole("button", { name: "Recevoir un lien de connexion" }));

    expect(Object.fromEntries(sendMagicLink.mock.calls[0]![1] as FormData)).toEqual({ email: "a@test.local", next: "/pipelines/new" });
    expect(await screen.findByRole("status")).toHaveTextContent("Un lien de connexion a été envoyé à a@test.local.");
  });

  it("explique un lien expiré", () => {
    search = new URLSearchParams("error=lien");
    render(<LoginForm googleEnabled={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Ce lien de connexion a expiré ou a déjà servi.");
  });

  it("n'affiche Google que si le fournisseur est activé", () => {
    const { rerender } = render(<LoginForm googleEnabled={false} />);
    expect(screen.queryByRole("button", { name: "Continuer avec Google" })).not.toBeInTheDocument();
    rerender(<LoginForm googleEnabled />);
    expect(screen.getByRole("button", { name: "Continuer avec Google" })).toBeInTheDocument();
  });
});
