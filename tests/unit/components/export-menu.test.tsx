// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExportMenu } from "@/components/pipeline/export-menu";

const ID = "4d1f7c3e-2b6a-4f8e-9c0d-1a2b3c4d5e6f";

describe("ExportMenu", () => {
  it("propose un téléchargement par format, vers la route d'export", () => {
    render(<ExportMenu pipelineId={ID} />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      ["zip", "txt", "srt", "md", "json"].map((format) => `/api/pipelines/${ID}/export?format=${format}`),
    );
    for (const link of links) expect(link).toHaveAttribute("download");
    expect(screen.getByRole("link", { name: "Voix off (TXT)" })).toHaveAttribute("title", "À coller tel quel dans ElevenLabs");
  });

  it("rappelle la déclaration du contenu IA", () => {
    render(<ExportMenu pipelineId={ID} />);
    expect(screen.getByText(/« Contenu modifié ou synthétique »/)).toBeInTheDocument();
  });
});
