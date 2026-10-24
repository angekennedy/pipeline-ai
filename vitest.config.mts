import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      // Pas de rapport HTML : ses scripts générés seraient analysés par ESLint.
      reporter: ["text", "json-summary"],
      include: ["src/lib/**", "src/components/**"],
      exclude: [
        "src/components/ui/**", // composants shadcn générés
        "src/lib/supabase/**", // wrappers couverts par les tests d'intégration (Supabase local)
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
