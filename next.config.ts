import type { NextConfig } from "next";
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

export default nextConfig;
