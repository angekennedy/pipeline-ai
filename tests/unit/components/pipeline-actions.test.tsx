// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Script } from "@/lib/ai/schemas";
import { sceneFieldName } from "@/lib/pipeline/script-form";
import { PipelineActionsProvider, RegenerateButton, RestoreButton } from "@/components/pipeline/pipeline-actions";
import { ScriptEditor } from "@/components/pipeline/script-editor";
import { validScript } from "../../fixtures/assets";

const regenerateAssets = vi.fn();
const restoreAssetVersion = vi.fn();
const saveScript = vi.fn();
vi.mock("@/app/(app)/w/[workspaceSlug]/pipelines/[pipelineId]/actions", () => ({
  regenerateAssets: (...args: unknown[]) => regenerateAssets(...args),
  restoreAssetVersion: (...args: unknown[]) => restoreAssetVersion(...args),
  saveScript: (...args: unknown[]) => saveScript(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const actions = { workspaceSlug: "mon-espace", pipelineId: "4d1f7c3e-2b6a-4f8e-9c0d-1a2b3c4d5e6f" };
const withActions = (node: React.ReactNode) => <PipelineActionsProvider value={actions}>{node}</PipelineActionsProvider>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RegenerateButton", () => {
  it("reste désactivé sans actions (démonstration, lecteur)", () => {
    render(<RegenerateButton types={["titles"]} credits={1} />);
    expect(screen.getByRole("button", { name: "Régénérer (1 crédit)" })).toBeDisabled();
  });

  it("envoie le pipeline, les assets et une clé de demande ; signale le lancement", async () => {
    const user = userEvent.setup();
    regenerateAssets.mockResolvedValue({ requested: true });
    render(withActions(<RegenerateButton types={["titles", "thumbnails"]} credits={2} label="Régénérer les dérivés" />));
    await user.click(screen.getByRole("button", { name: "Régénérer les dérivés (2 crédits)" }));

    const data = regenerateAssets.mock.calls[0]![1] as FormData;
    expect(data.get("workspaceSlug")).toBe("mon-espace");
    expect(data.get("pipelineId")).toBe(actions.pipelineId);
    expect(data.getAll("assetType")).toEqual(["titles", "thumbnails"]);
    expect(data.get("nonce")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText("Régénération lancée : la page se met à jour.")).toBeInTheDocument();
  });

  it("ouvre le modal de crédits insuffisants, et affiche un refus du plan", async () => {
    const user = userEvent.setup();
    regenerateAssets.mockResolvedValueOnce({ insufficient: { required: 6, available: 2 } });
    render(withActions(<RegenerateButton types={["seo"]} credits={6} />));
    await user.click(screen.getByRole("button", { name: /Régénérer/ }));
    expect(await screen.findByRole("dialog", { name: "Crédits insuffisants" })).toBeInTheDocument();

    regenerateAssets.mockResolvedValueOnce({ restriction: { reason: "premium", plan: "free" } });
    await user.click(screen.getByRole("button", { name: "Modifier le brief" }));
    await user.click(screen.getByRole("button", { name: /Régénérer/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Le script Premium n'est pas inclus");
  });

  it("affiche la limite de fréquence avec son délai, puis le disjoncteur de dépense", async () => {
    const user = userEvent.setup();
    regenerateAssets.mockResolvedValueOnce({ rateLimited: { minutes: 12 } });
    render(withActions(<RegenerateButton types={["seo"]} credits={1} />));
    await user.click(screen.getByRole("button", { name: /Régénérer/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Trop de demandes : réessayez dans 12 minutes. Aucun crédit n'a été débité.");

    regenerateAssets.mockResolvedValueOnce({ spendPaused: true });
    await user.click(screen.getByRole("button", { name: /Régénérer/ }));
    expect(await screen.findByText(/La génération est momentanément suspendue/)).toHaveAttribute("role", "alert");
  });
});

describe("RestoreButton", () => {
  it("envoie l'asset et la version à restaurer", async () => {
    const user = userEvent.setup();
    restoreAssetVersion.mockResolvedValue(undefined);
    render(withActions(<RestoreButton type="script" versionId="9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" />));
    await user.click(screen.getByRole("button", { name: "Restaurer" }));
    const data = restoreAssetVersion.mock.calls[0]![0] as FormData;
    expect(Object.fromEntries(data)).toMatchObject({ assetType: "script", versionId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", pipelineId: actions.pipelineId });
  });

  it("reste désactivé sans actions", () => {
    render(<RestoreButton type="script" versionId="v1" />);
    expect(screen.getByRole("button", { name: "Restaurer" })).toBeDisabled();
  });
});

describe("ScriptEditor", () => {
  it("préremplit chaque champ, envoie la saisie, puis se ferme une fois enregistré", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    saveScript.mockResolvedValue({ fieldErrors: {}, saved: true });
    render(<ScriptEditor script={validScript as Script} actions={actions} onDone={onDone} />);

    const scene2 = screen.getByRole("group", { name: /Scène 2/ });
    expect(scene2).toHaveTextContent("Contexte");
    const narration = screen.getAllByLabelText("Narration")[1]!;
    expect(narration).toHaveValue((validScript as Script).scenes[1]!.narration);
    await user.clear(narration);
    await user.type(narration, "Narration réécrite, assez longue pour être valide.");
    await user.click(screen.getByRole("button", { name: "Enregistrer une nouvelle version" }));

    const data = saveScript.mock.calls[0]![1] as FormData;
    expect(data.get(sceneFieldName(2, "narration"))).toBe("Narration réécrite, assez longue pour être valide.");
    expect(data.get("pipelineId")).toBe(actions.pipelineId);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("affiche les erreurs par champ sans se fermer", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    saveScript.mockResolvedValue({ fieldErrors: { [sceneFieldName(1, "narration")]: "narration" }, error: "fix" });
    render(<ScriptEditor script={validScript as Script} actions={actions} onDone={onDone} />);
    await user.click(screen.getByRole("button", { name: "Enregistrer une nouvelle version" }));

    const narration = (await screen.findAllByLabelText("Narration"))[0]!;
    expect(narration).toHaveAttribute("aria-invalid", "true");
    expect(narration).toHaveAccessibleDescription("La narration fait au moins 20 caractères.");
    expect(screen.getByRole("alert")).toHaveTextContent("Corrigez les champs signalés.");
    expect(onDone).not.toHaveBeenCalled();
  });
});
