import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Évaluations : appels réels et payants à l'API. Pas de MSW, pas de couverture, délais longs.
// La clé vient de .env.local (ANTHROPIC_API_KEY), jamais du dépôt.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../src", import.meta.url)),
      "server-only": fileURLToPath(new URL("../tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    testTimeout: 90 * 60_000,
    env: {
      // Exigée par la validation de src/lib/env/server.ts, inutilisée ici (pas de base).
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || "unused-by-evals",
    },
  },
});
