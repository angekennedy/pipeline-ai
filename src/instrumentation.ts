import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/observability/sentry";

// Appelé une fois au démarrage de chaque instance serveur (Node ou edge).
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") Sentry.init(sentryOptions("nodejs"));
  if (process.env.NEXT_RUNTIME === "edge") Sentry.init(sentryOptions("edge"));
}

// Erreurs des Server Components, route handlers, Server Actions et du proxy.
export const onRequestError = Sentry.captureRequestError;
