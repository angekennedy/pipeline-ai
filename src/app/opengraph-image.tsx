import { ImageResponse } from "next/og";

// Image de partage par défaut (tâche 5.1), générée au build. Hors du fournisseur next-intl : la
// marque et les cinq livrables, dans la langue par défaut du site (exemptée du contrôle des textes,
// tests/unit/i18n/coverage.test.ts).
export const alt = "Pipeline AI : script, titres, SEO, voix off et miniatures pour YouTube";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ASSETS = ["Script", "Titres", "SEO", "Voix off", "Miniatures"];

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#0a0a0a", color: "#fafafa" }}>
        <div style={{ fontSize: 88, fontWeight: 700, letterSpacing: -2 }}>Pipeline AI</div>
        <div style={{ marginTop: 24, fontSize: 40, color: "#a3a3a3", maxWidth: 960 }}>Du sujet à la vidéo prête à produire, pour les chaînes YouTube faceless.</div>
        <div style={{ marginTop: 56, display: "flex", gap: 16 }}>
          {ASSETS.map((asset) => (
            <div key={asset} style={{ display: "flex", padding: "12px 24px", borderRadius: 999, border: "2px solid #404040", fontSize: 30 }}>
              {asset}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
