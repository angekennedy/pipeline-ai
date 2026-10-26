// Vérifications avant la mise en production (tâche 5.5) : variables et documents légaux.
//   vercel env pull .env.production.local --environment=production
//   pnpm preflight .env.production.local
// N'affiche que des noms de variables, jamais leurs valeurs. Code de sortie 1 si un point bloquant
// n'est pas prêt.
import { LEGAL_ENTITY } from "../src/lib/legal.ts";
import { blockingFailures, preflightChecks } from "../src/lib/preflight.ts";

const file = process.argv[2];
if (file) process.loadEnvFile(file);

const checks = preflightChecks(process.env, LEGAL_ENTITY);
for (const check of checks) {
  const mark = check.ok ? "ok  " : check.blocking ? "FAIL" : "warn";
  console.log(`${mark}  ${check.id}${check.ok || !check.detail ? "" : ` : ${check.detail}`}`);
}
const failures = blockingFailures(checks);
console.log(failures.length ? `\n${failures.length} point(s) bloquant(s) avant la mise en production.` : "\nPrêt pour la mise en production.");
process.exitCode = failures.length ? 1 : 0;
