"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useSyncExternalStore } from "react";

// Erreur dans le layout racine : cette page remplace tout le document, sans les styles globaux ni le
// fournisseur next-intl. Ses trois phrases restent donc ici, dans la langue du navigateur.
const TEXT = {
  fr: { title: "Une erreur est survenue", text: "Vos pipelines et leurs assets ne sont pas perdus.", retry: "Réessayer" },
  en: { title: "Something went wrong", text: "Your pipelines and their assets are not lost.", retry: "Try again" },
};

const noSubscription = () => () => {};

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  // Langue du navigateur, lue sans abonnement (elle ne change pas pendant la page) ; français au serveur.
  const locale = useSyncExternalStore(
    noSubscription,
    () => (navigator.language.toLowerCase().startsWith("en") ? "en" : "fr"),
    () => "fr" as const,
  );
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  const text = TEXT[locale];

  return (
    <html lang={locale}>
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "15vh auto", padding: "0 16px" }}>
        <h1 style={{ fontSize: 20 }}>{text.title}</h1>
        <p>{text.text}</p>
        <button type="button" onClick={() => retry()}>
          {text.retry}
        </button>
      </body>
    </html>
  );
}
