import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";
import { INNGEST_STUB } from "./tests/e2e/inngest";

// Parcours connectés : le build et les tests visent le Supabase local, dont les clés (publiques, celles
// de la pile de développement) sont lues dans `supabase status`. Le build doit avoir été fait avec ces
// mêmes variables, puisque Next inscrit les NEXT_PUBLIC_* dans le bundle.
try {
  const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= status.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= status.PUBLISHABLE_KEY;
  process.env.SUPABASE_SECRET_KEY ??= status.SECRET_KEY;
} catch {
  // Pas de Supabase local : seules les pages publiques sont testables (auth.ts le signale).
}

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Sans PLAYWRIGHT_BASE_URL (preview Vercel), on teste le build de production local.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : [
        {
          command: `pnpm start --port ${PORT}`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          // Les événements Inngest partent vers le bouchon : aucune fonction ne s'exécute.
          env: { ...process.env, INNGEST_DEV: "1", INNGEST_EVENT_API_BASE_URL: `${INNGEST_STUB}/` } as Record<string, string>,
        },
        { command: "node tests/e2e/inngest-stub.mjs", url: `${INNGEST_STUB}/health`, reuseExistingServer: !process.env.CI },
      ],
});
