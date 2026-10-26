import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Écriture des résultats au format lu par le générateur de rapport (build-report-lite.mjs) :
// <flow>/<variant>/results.jsonl, traces/<id>_rep<k>.json et errors.jsonl, plus <flow>/_state.json.

export const FLOW_DIR = join(process.cwd(), "evals", "report");
const STATE_PATH = join(FLOW_DIR, "_state.json");

// Fichiers qui définissent l'évaluation : s'ils changent, les scores ne sont plus comparables.
export const HARNESS_PATHS = [
  "evals/briefs.golden.json",
  "evals/run-evals.eval.ts",
  "evals/judge-sanity.eval.ts",
  "evals/lib/checks.ts",
  "evals/lib/judge.ts",
  "evals/lib/run-case.ts",
  "evals/lib/results.ts",
];

export function harnessSha(): string {
  const hash = createHash("sha256");
  for (const path of HARNESS_PATHS) hash.update(path).update("\0").update(readFileSync(join(process.cwd(), path))).update("\0");
  return hash.digest("hex");
}

type State = { harness_sha?: string; [key: string]: unknown };

// Refuse de tourner sur une évaluation modifiée tant que le porteur du projet ne l'a pas approuvée
// (EVAL_APPROVE_HARNESS=1) : un run payant sur un runner ou des briefs changés sans relecture
// produirait des chiffres incomparables.
export function checkHarness(state: State, approve: boolean): void {
  const sha = harnessSha();
  if (state.harness_sha === sha) return;
  if (!approve) {
    throw new Error(
      `L'évaluation a changé depuis la dernière approbation (${HARNESS_PATHS.join(", ")}). ` +
        "Relisez les changements, puis relancez avec EVAL_APPROVE_HARNESS=1.",
    );
  }
  writeFileSync(STATE_PATH, `${JSON.stringify({ ...state, harness_sha: sha }, null, 2)}\n`);
}

export function readState(): State {
  return existsSync(STATE_PATH) ? (JSON.parse(readFileSync(STATE_PATH, "utf8")) as State) : {};
}

export type ResultRow = { prompt_id: string; rep: number; [key: string]: unknown };
export type ErrorRow = { prompt_id: string; rep: number; failure_class: string; message: string; [key: string]: unknown };

export function openVariant(variant: string) {
  if (!/^(baseline|v\d+)$/.test(variant)) throw new Error(`Variante invalide : ${variant} (baseline ou v<N>)`);
  const dir = join(FLOW_DIR, variant);
  mkdirSync(join(dir, "traces"), { recursive: true });
  const resultsPath = join(dir, "results.jsonl");
  const done = new Set(
    existsSync(resultsPath)
      ? readFileSync(resultsPath, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const row = JSON.parse(line) as ResultRow;
            return `${row.prompt_id}#${row.rep}`;
          })
      : [],
  );

  return {
    dir,
    // Reprise idempotente par (cas, répétition) : un cas déjà écrit n'est ni rejoué ni dupliqué.
    isDone: (id: string, rep: number) => done.has(`${id}#${rep}`),
    // Écrit dès la fin du cas : un plantage en cours de run ne perd pas les cas terminés.
    writeResult(row: ResultRow, trace: unknown) {
      writeFileSync(join(dir, "traces", `${row.prompt_id}_rep${row.rep}.json`), `${JSON.stringify(trace, null, 2)}\n`);
      appendFileSync(resultsPath, `${JSON.stringify(row)}\n`);
      done.add(`${row.prompt_id}#${row.rep}`);
    },
    // Échecs d'exécution (API, délai, modèle servi différent) : jamais comptés comme une note.
    writeError(row: ErrorRow) {
      appendFileSync(join(dir, "errors.jsonl"), `${JSON.stringify(row)}\n`);
    },
  };
}
