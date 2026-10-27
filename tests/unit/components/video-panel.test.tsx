// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VideoPanel } from "@/components/pipeline/video-panel";
import type { VideoView } from "@/lib/pipeline/view";
import type { VideoManifest } from "@/lib/video/manifest";

const manifest: VideoManifest = {
  url: "https://cdn.shotstack.test/render-1.mp4",
  renderId: "render-1",
  durationSeconds: 485,
  captionsPath: "ws/pipe/video/gen/captions.srt",
  voice: [{ sceneIndex: 1, path: "ws/pipe/video/gen/voice-1.mp3", start: 0, duration: 485 }],
  shots: [{ sceneIndex: 1, start: 0, length: 485, imagePath: "ws/pipe/video/gen/shot-1.jpg", prompt: "plan" }],
  sandbox: false,
};
const panel = (video: VideoView, pipelineStatus: "running" | "completed" | "partial" = "completed") =>
  render(<VideoPanel video={video} pipelineStatus={pipelineStatus} durationMinutes={8} />);

describe("VideoPanel", () => {
  it("annonce la création en cours tant que le pipeline tourne", () => {
    panel({ status: "pending", content: null, error: null }, "running");
    expect(screen.getByText(/Création de la vidéo : images, voix off, sous-titres, puis montage\. Comptez jusqu'à 12 min/)).toBeInTheDocument();
  });

  it("lit la vidéo prête, la propose au téléchargement et rappelle la déclaration YouTube", () => {
    const { container } = panel({ status: "ready", content: manifest, error: null });
    expect(container.querySelector("video")).toHaveAttribute("src", manifest.url);
    expect(screen.getByRole("link", { name: "Télécharger la vidéo (MP4)" })).toHaveAttribute("href", manifest.url);
    expect(screen.getByText("1080p · environ 8 min")).toBeInTheDocument();
    expect(screen.getByText(/« Contenu modifié ou synthétique » dans YouTube Studio/)).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("signale un rendu d'essai à ne pas publier", () => {
    panel({ status: "ready", content: { ...manifest, sandbox: true }, error: null });
    expect(screen.getByRole("note")).toHaveTextContent("filigrane");
  });

  it("explique l'échec et le remboursement des crédits", () => {
    panel({ status: "failed", content: null, error: { code: "PROVIDER_ERROR" } }, "partial");
    expect(screen.getByRole("alert")).toHaveTextContent("Le service de génération est indisponible ou surchargé. Réessayez dans quelques minutes. Les crédits de la vidéo vous ont été rendus.");
  });

  it("dit pourquoi la vidéo n'a pas été créée quand le script a échoué", () => {
    panel({ status: "skipped", content: null, error: null }, "partial");
    expect(screen.getByText(/Vidéo non créée : le script n'a pas abouti/)).toBeInTheDocument();
  });
});
