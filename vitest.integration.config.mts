import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests d'intégration contre le Supabase local (`pnpm db:start`), sans MSW : les requêtes vont
// réellement à Postgres, PostgREST, Auth et Realtime. Les clés sont celles, publiques, de la pile
// locale ; elles sont lues dans `supabase status` pour suivre les ports et la version de la CLI.
function localSupabase(): Record<string, string> {
  let status: Partial<Record<string, string>>;
  try {
    status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    throw new Error("Supabase local injoignable : lancer `pnpm db:start` avant `pnpm test:integration`.");
  }
  const { API_URL, PUBLISHABLE_KEY, SECRET_KEY, DB_URL } = status;
  if (!API_URL || !PUBLISHABLE_KEY || !SECRET_KEY || !DB_URL) throw new Error("`supabase status` incomplet : la pile locale a-t-elle démarré ?");
  return {
    NEXT_PUBLIC_SUPABASE_URL: API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: SECRET_KEY,
    SUPABASE_DB_URL: DB_URL,
    ANTHROPIC_API_KEY: "test-anthropic-key", // jamais appelée : requise par serverEnv
  };
}

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    env: localSupabase(),
    include: ["tests/integration/**/*.test.ts"],
    // Une seule base partagée : les fichiers s'exécutent l'un après l'autre.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
