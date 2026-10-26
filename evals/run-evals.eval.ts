import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { it } from "vitest";
import { BriefSchema, type Brief } from "@/lib/ai/schemas";
import type { ModelTier } from "@/lib/pipeline/registry";
import { runChecks } from "./lib/checks";
import { judgePipeline } from "./lib/judge";
import { checkHarness, openVariant, readState } from "./lib/results";
import { runCase, type CaseRun } from "./lib/run-case";

// Évaluation des pipelines sur les briefs de référence (tâche 1.11). Appels réels et payants :
//   EVAL_VARIANT=baseline pnpm evals           # Standard : script par Claude Sonnet 5.5
//   EVAL_VARIANT=v1 pnpm evals                 # Premium : script par Claude Opus 5.5
//   EVAL_VARIANT=v2 pnpm evals                 # Standard, prompts corrigés après la v0
//   EVAL_VARIANT=v3 pnpm evals                 # Standard, corrections après la v2
//   EVAL_CASES=fr-short-flamants pnpm evals    # sous-ensemble (essai)
// Puis : pnpm evals:report (evals/report/report.html).

const VARIANTS: Record<string, { tier: ModelTier; description: string }> = {
  baseline: { tier: "standard", description: "Standard : script rédigé par Claude Sonnet 5.5, dérivés par Claude Haiku 5.5." },
  v1: { tier: "premium", description: "Premium : script rédigé par Claude Opus 5.5, dérivés par Claude Haiku 5.5." },
  v2: { tier: "standard", description: "Standard après correction des prompts (script@2, titles@2, thumbnails@2) : durée, promesses des titres, texte des miniatures." },
  v3: { tier: "standard", description: "Standard, v2 plus titres sans mention du script (titles@3), 4 concepts de miniatures filtrés et tags trop longs écartés par le code (thumbnails@3)." },
};

// Échecs d'infrastructure (API, quota, crédit, bug) : ils ne disent rien de la qualité et vont dans
// errors.jsonl. Les autres codes (refus, schéma invalide, sortie tronquée) sont des résultats notés.
const INFRA_FAILURES = new Set(["PROVIDER_ERROR", "INTERNAL"]);

const CONCURRENCY = 3;
const CASE_TIMEOUT_MS = 20 * 60_000; // plafond par cas, indépendant de l'activité du stream
const REP = 0;

type GoldenCase = { id: string; tags: string[]; why: string; brief: Brief; mustNotContain?: string[] };

function loadCases(): GoldenCase[] {
  const cases = JSON.parse(readFileSync(join(process.cwd(), "evals", "briefs.golden.json"), "utf8")) as GoldenCase[];
  for (const c of cases) BriefSchema.parse(c.brief);
  const only = process.env.EVAL_CASES?.split(",").map((id) => id.trim()).filter(Boolean);
  if (only) {
    const unknown = only.filter((id) => !cases.some((c) => c.id === id));
    if (unknown.length > 0) throw new Error(`Cas inconnus : ${unknown.join(", ")}`);
    return cases.filter((c) => only.includes(c.id));
  }
  return cases;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error(`Plafond de ${ms / 60_000} min dépassé`), { failureClass: "timeout" })), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) await fn(item);
  }));
}

const sum = (run: CaseRun, key: "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreationTokens" | "repairs") =>
  Object.values(run.assets).reduce((total, asset) => total + asset[key], 0);

const micros = (run: CaseRun) => Object.values(run.assets).reduce((total, asset) => total + (asset.costUsdMicros ?? 0), 0);

it("évaluation des pipelines", async () => {
  const variant = process.env.EVAL_VARIANT ?? "baseline";
  const config = VARIANTS[variant];
  if (!config) throw new Error(`Variante inconnue : ${variant} (${Object.keys(VARIANTS).join(", ")})`);
  checkHarness(readState(), process.env.EVAL_APPROVE_HARNESS === "1");

  const out = openVariant(variant);
  if (variant !== "baseline") writeFileSync(join(out.dir, "change.md"), `# ${config.description}\n\nMêmes briefs et même notation que baseline.\n`);

  const client = new Anthropic({ maxRetries: 4 }); // backoff exponentiel avec jitter du SDK sur 429/529
  const cases = loadCases().filter((c) => !out.isDone(c.id, REP));
  console.log(`${cases.length} cas à exécuter (${variant}, formule ${config.tier}).`);

  await pool(cases, CONCURRENCY, async (c) => {
    const base = { prompt_id: c.id, rep: REP };
    try {
      const run = await withTimeout(runCase(c.brief, config.tier, { client }), CASE_TIMEOUT_MS);
      const infra = Object.entries(run.assets).filter(([, a]) => a.failure && INFRA_FAILURES.has(a.failure));
      if (infra.length > 0) {
        out.writeError({ ...base, failure_class: "api_error", message: infra.map(([t, a]) => `${t} : ${a.failureMessage ?? a.failure}`).join(" ; "), cost_usd: micros(run) / 1e6 });
        console.log(`✗ ${c.id} : erreur d'infrastructure (${infra[0]![1].failureMessage ?? infra[0]![1].failure})`);
        return;
      }
      // Modèle servi différent du modèle demandé (repli serveur, réacheminement) : comparaison faussée.
      const mismatch = Object.entries(run.assets).filter(([, a]) => a.model && !a.model.startsWith(a.expectedModel));
      if (mismatch.length > 0) {
        out.writeError({ ...base, failure_class: "served_model_mismatch", message: mismatch.map(([t, a]) => `${t} : ${a.model} au lieu de ${a.expectedModel}`).join(" ; "), cost_usd: micros(run) / 1e6 });
        return;
      }
      const checks = runChecks(run.output, c.mustNotContain);
      const judge = await judgePipeline(run.output, { client });
      const pipelineCost = micros(run) / 1e6;
      const judgeCost = (judge.costUsdMicros ?? 0) / 1e6;
      out.writeResult(
        {
          ...base,
          prompt: c.brief.topic,
          tags: c.tags,
          status: Object.values(run.assets).some((a) => a.failure === "MAX_TOKENS") ? "truncated" : "ok",
          grade: { ...judge.grade, ...checks.grade },
          explanation: { ...judge.explanation, ...checks.explanation },
          model: run.assets.script.model ?? run.assets.script.expectedModel,
          usage: {
            input_tokens: sum(run, "inputTokens"),
            output_tokens: sum(run, "outputTokens"),
            cache_read_input_tokens: sum(run, "cacheReadTokens"),
            cache_creation_input_tokens: sum(run, "cacheCreationTokens"),
          },
          judge_model: judge.model,
          judge_usage: judge.usage && { input_tokens: judge.usage.inputTokens, output_tokens: judge.usage.outputTokens },
          cost_usd: Number((pipelineCost + judgeCost).toFixed(4)),
          pipeline_cost_usd: Number(pipelineCost.toFixed(4)),
          judge_cost_usd: Number(judgeCost.toFixed(4)),
          latency_s: Number(run.latencyS.toFixed(1)),
          in_tokens: sum(run, "inputTokens"),
          out_tokens: sum(run, "outputTokens"),
          repairs: sum(run, "repairs"),
          meta: { why: c.why, tier: config.tier, assets: run.assets },
        },
        run.trace,
      );
      console.log(`✓ ${c.id} : juge ${judge.grade.judge.toFixed(2)}/5, contrôles ${(checks.grade.checks * 100).toFixed(0)} %${checks.failed.length ? ` (échecs : ${checks.failed.join(", ")})` : ""}, ${(pipelineCost + judgeCost).toFixed(3)} $`);
    } catch (error) {
      const failureClass = (error as { failureClass?: string }).failureClass ?? (error instanceof Anthropic.APIError ? "api_error" : "harness_error");
      out.writeError({ ...base, failure_class: failureClass, message: error instanceof Error ? error.message : String(error) });
      console.log(`✗ ${c.id} : ${failureClass} (${error instanceof Error ? error.message : String(error)})`);
    }
  });

  // Synthèse sur l'ensemble des lignes écrites pour cette variante (reprises comprises).
  const rows = readFileSync(join(out.dir, "results.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { status: string; grade: { judge: number; checks: number }; cost_usd: number });
  const ok = rows.filter((row) => row.status === "ok");
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const judges = ok.map((row) => row.grade.judge);
  const sd = Math.sqrt(mean(judges.map((v) => (v - mean(judges)) ** 2)));
  const ci = judges.length > 1 ? (1.96 * sd) / Math.sqrt(judges.length) : 0;
  console.log(
    `\n${variant} : juge ${mean(judges).toFixed(2)}/5 ± ${ci.toFixed(2)} (IC 95 %, n = ${judges.length}), ` +
      `contrôles ${(mean(ok.map((row) => row.grade.checks)) * 100).toFixed(0)} %, coût ${rows.reduce((a, row) => a + row.cost_usd, 0).toFixed(2)} $`,
  );
}, 90 * 60_000);
