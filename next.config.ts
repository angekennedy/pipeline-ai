import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
// Valide les variables publiques au build : un oubli fait échouer `next build`.
import "./src/lib/env/public";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Source maps envoyées à Sentry au build seulement si le token est là (builds Vercel) ; sinon
// (local, CI) le build ne contacte pas Sentry.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

// next-intl : configuration de chaque requête dans src/i18n/request.ts (langue et messages).
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: sentryAuthToken,
  sourcemaps: { disable: !sentryAuthToken },
  silent: !process.env.CI,
  telemetry: false,
});
