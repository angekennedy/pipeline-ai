import { sentryMiddleware } from "@inngest/middleware-sentry";
import { Inngest } from "inngest";

// Mode cloud par défaut : clé de signature requise en production (INNGEST_SIGNING_KEY).
// En local, `INNGEST_DEV=1` pointe vers le serveur de dev (`npx inngest-cli dev`).
//
// Sentry (initialisé dans src/instrumentation.ts, inactif sans DSN) reçoit les erreurs à la dernière
// tentative. Celles des étapes aussi : runPipelineSteps absorbe l'échec d'un asset dans un statut
// `partial`, la fonction elle-même réussit.
export const inngest = new Inngest({
  id: "pipeline-ai",
  middleware: [sentryMiddleware({ captureStepErrors: true })],
});
