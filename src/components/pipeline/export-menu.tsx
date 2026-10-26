import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { ExportFormat } from "@/lib/export/document";

// Téléchargements d'un pipeline (route /api/pipelines/[id]/export), avec le rappel de déclaration du
// contenu IA, repris dans chaque fichier.
const FORMATS: Array<{ format: ExportFormat; label: string; hint: string }> = [
  { format: "zip", label: "Tout (ZIP)", hint: "Tous les fichiers ci-dessous" },
  { format: "txt", label: "Voix off (TXT)", hint: "À coller tel quel dans ElevenLabs" },
  { format: "srt", label: "Sous-titres (SRT)", hint: "Minutage estimé, à recaler sur l'audio" },
  { format: "md", label: "Document (Markdown)", hint: "Script, titres, SEO, voix off, miniatures" },
  { format: "json", label: "Données (JSON)", hint: "Pour un outil ou une automatisation" },
];

export function ExportMenu({ pipelineId }: { pipelineId: string }) {
  return (
    <section aria-labelledby="exports" className="grid gap-3 rounded-xl border p-4">
      <h2 id="exports" className="font-semibold">
        Exporter
      </h2>
      <ul className="flex flex-wrap gap-2">
        {FORMATS.map(({ format, label, hint }) => (
          <li key={format}>
            <a
              href={`/api/pipelines/${pipelineId}/export?format=${format}`}
              download
              title={hint}
              className={buttonVariants({ variant: format === "zip" ? "default" : "outline", size: "sm" })}
            >
              <Download aria-hidden="true" />
              {label}
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Avant la mise en ligne, vérifiez les faits signalés. Un contenu réaliste généré par IA (voix ou images pouvant passer pour réelles) se
        déclare dans YouTube Studio : « Contenu modifié ou synthétique ».
      </p>
    </section>
  );
}
