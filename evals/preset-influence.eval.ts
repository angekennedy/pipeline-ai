import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { PromptContext } from "@/lib/ai/prompts";
import { BriefSchema, type AssetType, type Brief } from "@/lib/ai/schemas";
import { callStructured } from "@/lib/ai/structured";
import { registry, type AssetContent, type AssetDefinition, type ModelTier } from "@/lib/pipeline/registry";
import { evalPreset, pickBannedWords, summarize, titlesWithBannedWords, type PresetCaseResult } from "./lib/preset";

// Influence du preset de chaîne sur les titres (tâche 2.5). Appels réels et payants, hors de la CI :
//   EVAL_PRESET=1 pnpm evals preset-influence
//   EVAL_PRESET=1 EVAL_CASES=fr-histoire-rome pnpm evals preset-influence   # essai sur un cas
// Par cas : un script (Standard), puis trois jeux de titres sur ce même script. Le premier, sans
// preset, désigne les mots interdits ; le témoin, sans preset, et le passage avec preset sont comparés.
// Résultat : evals/report/preset/results.json.

const DEFAULT_CASES = ["fr-histoire-rome", "en-finance-compound", "es-ciencia-cielo"];
const TIER: ModelTier = "standard";

type GoldenCase = { id: string; brief: Brief };

function loadCases(): GoldenCase[] {
  const cases = JSON.parse(readFileSync(join(process.cwd(), "evals", "briefs.golden.json"), "utf8")) as GoldenCase[];
  const only = process.env.EVAL_CASES?.split(",").map((id) => id.trim()).filter(Boolean) ?? DEFAULT_CASES;
  const selected = cases.filter((c) => only.includes(c.id));
  if (selected.length !== only.length) throw new Error(`Cas inconnus : ${only.filter((id) => !cases.some((c) => c.id === id)).join(", ")}`);
  return selected.map((c) => ({ ...c, brief: BriefSchema.parse(c.brief) }));
}

let costUsdMicros = 0;

// Même appel que generateAsset (prompt, schéma, post-traitement du registre), sans store ni base.
async function generate<K extends AssetType>(type: K, ctx: PromptContext): Promise<AssetContent[K]> {
  const def = registry[type] as unknown as AssetDefinition<K>;
  const prompt = def.prompt.build(ctx);
  const result = await callStructured({
    modelKey: def.modelKey(TIER),
    system: prompt.system,
    messages: prompt.messages,
    schema: (def.outputSchema ?? def.schema)(ctx),
    maxTokens: def.maxTokens(ctx.brief),
  });
  costUsdMicros += result.costUsdMicros ?? 0;
  return def.postProcess(result.data, ctx);
}

const titlesOf = async (ctx: PromptContext) => (await generate("titles", ctx)).variants.map((variant) => variant.title);

it.runIf(process.env.EVAL_PRESET === "1")("le preset de chaîne écarte des titres les mots qu'il interdit", async () => {
  const results: PresetCaseResult[] = [];
  for (const { id, brief } of loadCases()) {
    const script = await generate("script", { brief, channel: null });
    const first = await titlesOf({ brief, channel: null, script });
    const banned = pickBannedWords(first, brief);
    const [control, withPreset] = await Promise.all([
      titlesOf({ brief, channel: null, script }),
      titlesOf({ brief, channel: evalPreset(brief, banned), script }),
    ]);
    const result = {
      id,
      banned,
      control: { titles: control.length, withBanned: titlesWithBannedWords(control, banned) },
      preset: { titles: withPreset.length, withBanned: titlesWithBannedWords(withPreset, banned) },
    };
    results.push(result);
    console.log(`${id} : interdits ${banned.join(", ")} · témoin ${result.control.withBanned}/${result.control.titles} · preset ${result.preset.withBanned}/${result.preset.titles}`);
  }

  const summary = summarize(results);
  const dir = join(process.cwd(), "evals", "report", "preset");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "results.json"), `${JSON.stringify({ measuredAt: new Date().toISOString(), tier: TIER, costUsd: costUsdMicros / 1e6, summary, results }, null, 2)}\n`);
  console.log(`Témoin ${(summary.controlRate * 100).toFixed(0)} % · preset ${(summary.presetRate * 100).toFixed(0)} % · coût ${(costUsdMicros / 1e6).toFixed(2)} $`);

  expect(results.every((r) => r.banned.length > 0), "chaque cas doit fournir des mots à interdire").toBe(true);
  expect(summary.presetRate).toBeLessThan(summary.controlRate);
});
