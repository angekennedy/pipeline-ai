"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Erreur dans le layout racine : cette page remplace tout le document, sans les styles globaux.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "15vh auto", padding: "0 16px" }}>
        <h1 style={{ fontSize: 20 }}>Une erreur est survenue</h1>
        <p>Vos pipelines et leurs assets ne sont pas perdus.</p>
        <button type="button" onClick={() => retry()}>
          Réessayer
        </button>
      </body>
    </html>
  );
}
