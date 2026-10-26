import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    // Node par défaut : le code serveur (SDK Anthropic compris) refuse un environnement de type navigateur.
    // Les tests de composants passent en jsdom avec `// @vitest-environment jsdom` en tête de fichier.
    environment: "node",
    // Valeurs factices : aucun appel réseau réel, MSW intercepte tout.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      SUPABASE_SECRET_KEY: "test-secret-key",
      ANTHROPIC_API_KEY: "test-anthropic-key",
    },
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}"], // intégration : vitest.integration.config.mts
    coverage: {
      provider: "v8",
      // Pas de rapport HTML : ses scripts générés seraient analysés par ESLint.
      reporter: ["text", "json-summary"],
      include: ["src/lib/**", "src/components/**", "src/hooks/**"],
      exclude: [
        "src/components/ui/**", // composants shadcn générés
        "src/lib/supabase/**", // wrappers couverts par les tests d'intégration (Supabase local)
        // Requêtes sous RLS, couvertes par les tests d'intégration (dashboard, workspaces, channels)
        "src/lib/channels/store.ts",
        "src/lib/pipeline/list.ts",
        "src/lib/pipeline/load-view.ts",
        "src/lib/workspaces/**",
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
