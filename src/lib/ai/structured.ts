import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { getAnthropic } from "./client";
import { modelFor, type ModelKey } from "./models";
import { messageCostUsdMicros } from "./pricing";

// Le tool use forcé renvoie une 400 sur Opus et Sonnet 5.5 : on passe par les sorties structurées
// natives (`output_config.format`). L'API ignore les bornes (min, max, longueurs) : le SDK les retire
// du JSON Schema envoyé, et la validation Zod ci-dessous les applique.
const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_REPAIRS = 1;
const MAX_TRUNCATION_RETRIES = 1;
const TRUNCATION_GROWTH = 1.5;

export type SchemaIssue = { path: PropertyKey[]; message: string };

// Erreurs définitives : relancer la même requête ne changerait rien.
export class LlmError extends Error {
  readonly retryable = false;

  constructor(
    readonly code: "SCHEMA_INVALID" | "CONTENT_REFUSED" | "MAX_TOKENS",
    message: string,
    readonly costUsdMicros: number | null,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class LlmValidationError extends LlmError {
  constructor(readonly issues: SchemaIssue[], costUsdMicros: number | null) {
    super("SCHEMA_INVALID", `Sortie non conforme au schéma : ${formatIssues(issues)}`, costUsdMicros);
  }
}

export class LlmRefusalError extends LlmError {
  constructor(readonly category: string | null, readonly explanation: string | null, costUsdMicros: number | null) {
    super("CONTENT_REFUSED", `Requête refusée par le modèle (${category ?? "catégorie inconnue"})`, costUsdMicros);
  }
}

export class LlmTruncatedError extends LlmError {
  constructor(readonly maxTokens: number, costUsdMicros: number | null) {
    super("MAX_TOKENS", `Sortie tronquée à ${maxTokens} tokens`, costUsdMicros);
  }
}

export type UsageTotals = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number };

export type StructuredRequest<T> = {
  modelKey: ModelKey;
  system: string | Anthropic.Beta.BetaTextBlockParam[];
  messages: Anthropic.Beta.BetaMessageParam[];
  schema: z.ZodType<T>;
  maxTokens: number;
  onText?: (delta: string, snapshot: string) => void;
  signal?: AbortSignal;
};

export type StructuredResult<T> = {
  data: T;
  model: string; // modèle qui a produit la réponse finale (différent en cas de repli)
  usage: UsageTotals;
  costUsdMicros: number | null; // null si un modèle de la chaîne n'a pas de tarif connu
  attempts: number;
  repairs: number;
};

function formatIssues(issues: SchemaIssue[]) {
  return issues.map((issue) => `${issue.path.map(String).join(".") || "(racine)"}: ${issue.message}`).join("; ");
}

function validate<T>(schema: z.ZodType<T>, text: string): { ok: true; data: T } | { ok: false; issues: SchemaIssue[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: [], message: "Invalid JSON" }] };
  }
  const result = schema.safeParse(json);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, issues: result.error.issues.map(({ path, message }) => ({ path, message })) };
}

const repairInstruction = (issues: SchemaIssue[]) =>
  "Your previous response did not satisfy the required schema. Fix every issue below, then reply " +
  "with the complete corrected JSON object only.\n" +
  issues.map((issue) => `- ${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`).join("\n");

export async function callStructured<T>(
  request: StructuredRequest<T>,
  { client = getAnthropic() }: { client?: Anthropic } = {},
): Promise<StructuredResult<T>> {
  const { id: model, effort, serverFallback } = modelFor(request.modelKey);
  const { schema: jsonSchema } = zodOutputFormat(request.schema);

  let messages = request.messages;
  let maxTokens = request.maxTokens;
  let attempts = 0;
  let repairs = 0;
  let truncations = 0;
  let costUsdMicros: number | null = 0;
  const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

  for (;;) {
    attempts++;
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: maxTokens,
        system: request.system,
        messages,
        output_config: { effort, format: { type: "json_schema", schema: jsonSchema } },
        ...(serverFallback ? { betas: [SERVER_FALLBACK_BETA], fallbacks: "default" as const } : {}),
      },
      { signal: request.signal },
    );
    if (request.onText) stream.on("text", request.onText);
    const message = await stream.finalMessage();

    usage.inputTokens += message.usage.input_tokens;
    usage.outputTokens += message.usage.output_tokens;
    usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
    usage.cacheCreationTokens += message.usage.cache_creation_input_tokens ?? 0;
    const cost = messageCostUsdMicros(message);
    costUsdMicros = costUsdMicros === null || cost === null ? null : costUsdMicros + cost;

    // À vérifier avant de lire le contenu : une sortie refusée ou tronquée ne respecte pas le schéma.
    if (message.stop_reason === "refusal") {
      throw new LlmRefusalError(message.stop_details?.category ?? null, message.stop_details?.explanation ?? null, costUsdMicros);
    }
    if (message.stop_reason === "max_tokens") {
      if (truncations++ < MAX_TRUNCATION_RETRIES) {
        maxTokens = Math.ceil(maxTokens * TRUNCATION_GROWTH);
        continue;
      }
      throw new LlmTruncatedError(maxTokens, costUsdMicros);
    }

    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    const result = validate(request.schema, text);
    if (result.ok) return { data: result.data, model: message.model, usage, costUsdMicros, attempts, repairs };

    if (repairs >= MAX_REPAIRS) throw new LlmValidationError(result.issues, costUsdMicros);
    repairs++;
    // Historique en ajout seul : la réponse est renvoyée telle quelle (blocs de réflexion compris).
    messages = [
      ...messages,
      { role: "assistant", content: message.content },
      { role: "user", content: repairInstruction(result.issues) },
    ];
  }
}
