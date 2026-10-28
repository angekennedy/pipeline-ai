// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineActionsProvider } from "@/components/pipeline/pipeline-actions";
import { VideoPanel } from "@/components/pipeline/video-panel";
import type { VideoView } from "@/lib/pipeline/view";
import type { VideoManifest } from "@/lib/video/manifest";

const generateVideo = vi.fn();
vi.mock("@/app/(app)/w/[workspaceSlug]/pipelines/[pipelineId]/actions", () => ({
  generateVideo: (...args: unknown[]) => generateVideo(...args),
  regenerateAssets: vi.fn(),
  restoreAssetVersion: vi.fn(),
  saveScript: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const manifest: VideoManifest = {
  url: "https://cdn.shotstack.test/render-1.mp4",
  renderId: "render-1",
  durationSeconds: 485,
  captionsPath: "ws/pipe/video/gen/captions.srt",
  voice: [{ sceneIndex: 1, path: "ws/pipe/video/gen/voice-1.mp3", start: 0, duration: 485 }],
  shots: [{ sceneIndex: 1, start: 0, length: 485, imagePath: "ws/pipe/video/gen/shot-1.jpg", prompt: "plan" }],
  sandbox: false,
};
const actions = { workspaceSlug: "mon-espace", pipelineId: "4d1f7c3e-2b6a-4f8e-9c0d-1a2b3c4d5e6f" };
const view = (video: Partial<VideoView>): VideoView => ({ status: "pending", content: null, error: null, credits: 480, scriptChanged: false, ...video });
const panel = (video: Partial<VideoView>, pipelineStatus: "running" | "completed" | "partial" = "completed") =>
  render(
    <PipelineActionsProvider value={actions}>
      <VideoPanel pipelineId="pipe-1" video={view(video)} pipelineStatus={pipelineStatus} />
    </PipelineActionsProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VideoPanel", () => {
  it("attend la fin du script, sans bouton, tant que le pipeline tourne", () => {
    panel({}, "running");
    expect(screen.getByText(/relisez-le et ajustez-le, puis lancez la vidéo/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("invite à relire le script, puis lance la vidéo à son coût", async () => {
    const user = userEvent.setup();
    generateVideo.mockResolvedValue({ requested: true });
    panel({});
    expect(screen.getByText(/la vidéo suivra exactement sa version actuelle/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Générer la vidéo (480 crédits)" }));
    const data = generateVideo.mock.calls[0]![1] as FormData;
    expect(data.get("pipelineId")).toBe(actions.pipelineId);
    expect(data.get("nonce")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByRole("status")).toHaveTextContent("Vidéo lancée");
  });

  it("refuse une deuxième vidéo en cours", async () => {
    const user = userEvent.setup();
    generateVideo.mockResolvedValue({ videoBusy: true });
    panel({});
    await user.click(screen.getByRole("button", { name: /Générer la vidéo/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Une vidéo de ce pipeline est déjà en cours.");
  });

  it("annonce la création en cours, sur la durée du script", () => {
    panel({ status: "running" });
    expect(screen.getByText(/Comptez jusqu'à 12 min/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lit la vidéo prête, la propose au téléchargement et rappelle la déclaration YouTube", () => {
    const { container } = panel({ status: "ready", content: manifest });
    expect(container.querySelector("video")).toHaveAttribute("src", manifest.url);
    // Téléchargement par la route de l'application (pièce jointe), lecture directe depuis le CDN.
    expect(screen.getByRole("link", { name: "Télécharger la vidéo (MP4)" })).toHaveAttribute("href", "/api/pipelines/pipe-1/video");
    expect(screen.getByText("1080p · environ 8 min")).toBeInTheDocument();
    expect(screen.getByText(/« Contenu modifié ou synthétique » dans YouTube Studio/)).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Générer une nouvelle vidéo (480 crédits)" })).toBeEnabled();
  });

  it("signale un script modifié depuis la vidéo", () => {
    panel({ status: "ready", content: manifest, scriptChanged: true });
    expect(screen.getByText(/Le script a changé depuis cette vidéo/)).toBeInTheDocument();
  });

  it("signale un rendu d'essai à ne pas publier", () => {
    panel({ status: "ready", content: { ...manifest, sandbox: true } });
    expect(screen.getByRole("note")).toHaveTextContent("filigrane");
  });

  it("explique l'échec et le remboursement des crédits, et propose de relancer", () => {
    panel({ status: "failed", error: { code: "PROVIDER_ERROR" } }, "partial");
    expect(screen.getByRole("alert")).toHaveTextContent("Le service de génération est indisponible ou surchargé. Réessayez dans quelques minutes. Les crédits de la vidéo vous ont été rendus.");
    expect(screen.getByRole("button", { name: /Relancer la vidéo/ })).toBeInTheDocument();
  });

  it("dit pourquoi la vidéo n'est pas possible sans script", () => {
    panel({ credits: null }, "failed" as never);
    expect(screen.getByText(/le script n'a pas abouti/)).toBeInTheDocument();
  });
});
