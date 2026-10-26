// Options Sentry communes au serveur, à l'edge et au navigateur. Sans DSN (local, CI), le SDK
// reste désactivé : aucun envoi. Le DSN n'est pas un secret, il identifie seulement le projet.

type Runtime = "nodejs" | "edge" | "browser";

export function sentryOptions(runtime: Runtime) {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  // `NEXT_PUBLIC_VERCEL_ENV` : variable système de Vercel (production, preview, development).
  const environment = process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development";
  return {
    dsn,
    enabled: Boolean(dsn),
    environment,
    initialScope: { tags: { runtime } },
    // Briefs, scripts et consignes de régénération sont du contenu utilisateur : ni IP, ni cookies,
    // ni corps de requête dans les événements.
    sendDefaultPii: false,
    tracesSampleRate: environment === "production" ? 0.1 : 1,
  };
}
