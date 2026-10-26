import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/observability/sentry";

// Chargé avant que l'application devienne interactive. Pas de Session Replay : il enregistrerait
// les briefs et les scripts affichés.
Sentry.init(sentryOptions("browser"));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
