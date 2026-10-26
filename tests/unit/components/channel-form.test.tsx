// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelForm } from "@/components/channels/channel-form";

const CHANNEL = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const saveChannel = vi.fn();
vi.mock("@/app/(app)/w/[workspaceSlug]/channels/actions", () => ({ saveChannel: (...args: unknown[]) => saveChannel(...args) }));

beforeEach(() => {
  saveChannel.mockReset();
});

describe("ChannelForm", () => {
  it("crée un preset : envoie la saisie et le workspace, sans id", async () => {
    const user = userEvent.setup();
    saveChannel.mockResolvedValue({ fieldErrors: {}, values: {} });
    render(<ChannelForm workspaceSlug="mon-espace" />);
    expect(screen.getByLabelText("Langue")).toHaveValue("fr");
    expect(screen.getByLabelText("Ton")).toHaveValue(""); // « Au choix du brief »

    await user.type(screen.getByLabelText("Nom du preset"), "Mystères");
    await user.type(screen.getByLabelText("Niche"), "Histoire");
    await user.selectOptions(screen.getByLabelText("Rythme"), "slow");
    await user.type(screen.getByLabelText("Mots interdits"), "secret, choc");
    await user.click(screen.getByRole("button", { name: "Créer le preset" }));

    const data = saveChannel.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(data)).toMatchObject({ workspaceSlug: "mon-espace", name: "Mystères", niche: "Histoire", voicePace: "slow", bannedWords: "secret, choc" });
    expect(data.has("channelId")).toBe(false);
  });

  it("modifie un preset : formulaire prérempli et id envoyé", async () => {
    const user = userEvent.setup();
    saveChannel.mockResolvedValue({ fieldErrors: {}, values: {} });
    render(
      <ChannelForm
        workspaceSlug="mon-espace"
        channelId={CHANNEL}
        initialValues={{ name: "Mystères", niche: "Histoire", defaultLanguage: "en", tone: "mysterious" }}
      />,
    );
    expect(screen.getByLabelText("Nom du preset")).toHaveValue("Mystères");
    expect(screen.getByLabelText("Langue")).toHaveValue("en");
    expect(screen.getByLabelText("Ton")).toHaveValue("mysterious");

    await user.click(screen.getByRole("button", { name: "Enregistrer le preset" }));
    expect((saveChannel.mock.calls[0]![1] as FormData).get("channelId")).toBe(CHANNEL);
  });

  it("affiche les erreurs par champ et la limite du plan", async () => {
    const user = userEvent.setup();
    saveChannel.mockResolvedValue({
      fieldErrors: { thumbnailPalette: true },
      values: { name: "Mystères", thumbnailPalette: "rouge" },
      restriction: { reason: "channel_presets", plan: "free", limit: 1 },
    });
    render(<ChannelForm workspaceSlug="mon-espace" />);
    await user.click(screen.getByRole("button", { name: "Créer le preset" }));

    await screen.findByRole("alert"); // état renvoyé par l'action, appliqué
    const palette = screen.getByLabelText("Palette des miniatures");
    expect(palette).toHaveAttribute("aria-invalid", "true");
    expect(palette).toHaveAccessibleDescription(expect.stringContaining("#RRGGBB"));
    expect(screen.getByLabelText("Nom du preset")).toHaveValue("Mystères");
    expect(screen.getByRole("alert")).toHaveTextContent("Le plan Free est limité à 1 preset de chaîne");
    expect(screen.getByRole("link", { name: "Voir les tarifs" })).toHaveAttribute("href", "/pricing");
  });
});
