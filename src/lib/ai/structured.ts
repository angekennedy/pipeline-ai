import "server-only";
import { z } from "zod";
import { getOpenAI } from "./client";
import { modelFor, type ModelKey } from "./models";
import { MAX_OUTPUT_TOKENS, type ChatMessage, type OpenAIClient } from "./openai";
import { costUsdMicros as priceOf } from "./pricing";

// Sorties structurées de l'API OpenAI (`response_format: json_schema`), en mode non strict : le mode
// strict refuse les champs facultatifs et une partie des bornes de Zod. Le schéma guide le modèle,
// la validation Zod ci-dessous fait foi, avec une réparation en cas d'écart.
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

// `inputTokens` : entrée hors cache. OpenAI ne facture pas d'écriture en cache : `cacheCreationTokens`
// reste à 0, conservé pour la télémétrie déjà enregistrée.
export type UsageTotals = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number };

export type PromptMessage = { role: "user" | "assistant"; content: string };

export type StructuredRequest<T> = {
  modelKey: ModelKey;
  system: string;
  messages: PromptMessage[];
  schema: z.ZodType<T>;
  maxTokens: number;
  onText?: (delta: string, snapshot: string) => void;
  signal?: AbortSignal;
};

export type StructuredResult<T> = {
  data: T;
  model: string; // instantané du modèle qui a produit la réponse finale
  usage: UsageTotals;
  costUsdMicros: number | null; // null si un modèle n'a pas de tarif connu
  attempts: number;
  repairs: number;
};

function formatIssues(issues: SchemaIssue[]) {
  return issues.map((issue) => `${issue.path.map(String).join(".") || "(racine)"}: ${issue.message}`).join("; ");
}

type JsonSchema = {
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

// Forme comparable d'une valeur de liste : casse, espaces et tirets bas ignorés, mots dans l'ordre
// alphabétique (« Left Top » = « top-left »).
const canonical = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .sort()
    .join("-");

// Nom de champ comparable : casse, espaces, tirets et tirets bas ignorés (« working_title » = « workingTitle »).
const keyOf = (key: string) => key.toLowerCase().replace(/[\s_-]+/g, "");

// Le mode non strict ne garantit pas les listes fermées (enum) : une valeur écrite autrement
// (« Top Left », « top_left ») est ramenée à la valeur autorisée qui lui correspond, avant Zod.
// Une valeur sans équivalent reste telle quelle et part en réparation. De même, un champ dont le nom
// est écrit autrement prend le nom attendu, s'il n'est pas déjà présent.
export function coerceEnums(schema: JsonSchema, value: unknown, root: JsonSchema = schema): unknown {
  const ref = schema.$ref?.match(/^#\/\$defs\/(.+)$/)?.[1];
  if (ref && root.$defs?.[ref]) return coerceEnums(root.$defs[ref], value, root);
  for (const sub of [...(schema.allOf ?? []), ...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) value = coerceEnums(sub, value, root);
  if (schema.enum && typeof value === "string" && !schema.enum.includes(value)) {
    return schema.enum.find((option) => typeof option === "string" && canonical(option) === canonical(value)) ?? value;
  }
  if (Array.isArray(value) && schema.items) return value.map((item) => coerceEnums(schema.items!, item, root));
  if (value && typeof value === "object" && !Array.isArray(value) && schema.properties) {
    const properties = schema.properties;
    const names = new Map(Object.keys(properties).map((name) => [keyOf(name), name]));
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const name = properties[key] ? key : names.get(keyOf(key));
        const renamed = name && (name === key || !(name in value)) ? name : key;
        return [renamed, properties[renamed] ? coerceEnums(properties[renamed], item, root) : item];
      }),
    );
  }
  return value;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const MAX_UNWRAP_DEPTH = 3;

// Objet attendu à la racine. Le mode non strict laisse le modèle l'emballer ({"script": {…}},
// {"output": {…}}), le renvoyer encodé dans une chaîne, dans une liste, ou recopier le schéma
// ({"type": "object", "properties": {…}}) : l'objet qui porte tous les champs requis de la racine
// est repris tel quel, sans réparation. Une racine qui porte déjà l'un d'eux n'est pas touchée.
export function unwrapRoot(schema: JsonSchema, value: unknown, depth = 0): unknown {
  const required = schema.required ?? [];
  if (required.length === 0 || depth > MAX_UNWRAP_DEPTH) return value;
  if (typeof value === "string") {
    try {
      return unwrapRoot(schema, JSON.parse(value), depth + 1);
    } catch {
      return value;
    }
  }
  if (isRecord(value) && required.some((key) => key in value)) return value;
  const children = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
  for (const child of children) {
    const found = unwrapRoot(schema, child, depth + 1);
    if (isRecord(found) && required.every((key) => key in found)) return found;
  }
  return value;
}

// Aucun champ requis à la racine : l'objet est ailleurs. Le dire au modèle (et dans le message
// d'erreur enregistré), avec les clés reçues, plutôt que la liste des champs manquants.
function rootIssue(schema: JsonSchema, value: unknown): SchemaIssue | null {
  const required = schema.required ?? [];
  if (required.length === 0 || (isRecord(value) && required.some((key) => key in value))) return null;
  const received = isRecord(value) ? `an object with keys ${Object.keys(value).slice(0, 10).join(", ") || "(none)"}` : Array.isArray(value) ? "an array" : `a ${typeof value}`;
  return {
    path: [],
    message: `Expected the requested JSON object itself at the root, with the keys ${required.join(", ")}; received ${received}. Do not wrap it in another key and do not return the JSON Schema.`,
  };
}

function validate<T>(schema: z.ZodType<T>, text: string, jsonSchema: JsonSchema): { ok: true; data: T } | { ok: false; issues: SchemaIssue[] } {
  let json: unknown;
  try {
    json = unwrapRoot(jsonSchema, JSON.parse(text));
  } catch {
    return { ok: false, issues: [{ path: [], message: "Invalid JSON" }] };
  }
  const result = schema.safeParse(coerceEnums(jsonSchema, json));
  if (result.success) return { ok: true, data: result.data };
  const root = rootIssue(jsonSchema, json);
  return { ok: false, issues: root ? [root] : result.error.issues.map(({ path, message }) => ({ path, message })) };
}

// Forme d'entrée : le modèle produit ce que Zod lit, avant transformations éventuelles. Les
// `pattern` sont retirés : l'API refuse les expressions JavaScript (`\p{L}` et le drapeau `u`), et
// Zod les applique de toute façon, avec réparation.
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const json = withoutPatterns(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function withoutPatterns(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutPatterns);
  if (node === null || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node)
      // Un champ nommé « pattern » sous `properties` est une propriété, pas une contrainte.
      .filter(([key, value]) => key !== "pattern" || typeof value !== "string")
      .map(([key, value]) => [key, withoutPatterns(value)]),
  );
}

const repairInstruction = (issues: SchemaIssue[]) =>
  "Your previous response did not satisfy the required schema. Fix every issue below, then reply " +
  "with the complete corrected JSON object only.\n" +
  issues.map((issue) => `- ${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`).join("\n");

export async function callStructured<T>(
  request: StructuredRequest<T>,
  { client = getOpenAI() }: { client?: OpenAIClient } = {},
): Promise<StructuredResult<T>> {
  const { id: model } = modelFor(request.modelKey);
  const schema = jsonSchemaOf(request.schema);

  let messages: ChatMessage[] = [{ role: "system", content: request.system }, ...request.messages];
  let maxTokens = Math.min(request.maxTokens, MAX_OUTPUT_TOKENS);
  let attempts = 0;
  let repairs = 0;
  let truncations = 0;
  let costUsdMicros: number | null = 0;
  const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

  for (;;) {
    attempts++;
    const reply = await client.streamChat(
      {
        model,
        messages,
        max_completion_tokens: maxTokens,
        response_format: { type: "json_schema", json_schema: { name: "output", schema, strict: false } },
      },
      { signal: request.signal, onText: request.onText },
    );

    const cached = reply.usage.prompt_tokens_details?.cached_tokens ?? 0;
    usage.inputTokens += reply.usage.prompt_tokens - cached;
    usage.cacheReadTokens += cached;
    usage.outputTokens += reply.usage.completion_tokens;
    const cost = priceOf(reply.model || model, reply.usage);
    costUsdMicros = costUsdMicros === null || cost === null ? null : costUsdMicros + cost;

    // À vérifier avant de lire le contenu : une sortie refusée ou tronquée ne respecte pas le schéma.
    if (reply.refusal) throw new LlmRefusalError(null, reply.refusal, costUsdMicros);
    if (reply.finishReason === "content_filter") throw new LlmRefusalError("content_filter", null, costUsdMicros);
    if (reply.finishReason === "length") {
      if (truncations++ < MAX_TRUNCATION_RETRIES && maxTokens < MAX_OUTPUT_TOKENS) {
        maxTokens = Math.min(MAX_OUTPUT_TOKENS, Math.ceil(maxTokens * TRUNCATION_GROWTH));
        continue;
      }
      throw new LlmTruncatedError(maxTokens, costUsdMicros);
    }

    const result = validate(request.schema, reply.text, schema);
    if (result.ok) return { data: result.data, model: reply.model || model, usage, costUsdMicros, attempts, repairs };

    if (repairs >= MAX_REPAIRS) throw new LlmValidationError(result.issues, costUsdMicros);
    repairs++;
    // Historique en ajout seul : le préfixe reste identique et profite du cache de l'API.
    messages = [...messages, { role: "assistant", content: reply.text }, { role: "user", content: repairInstruction(result.issues) }];
  }
}
