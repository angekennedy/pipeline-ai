import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";

// « 100 % des chaînes traduites » (tâche 4.4) : mêmes clés et mêmes variables en français et en
// anglais, et aucun texte d'interface écrit en dur dans les pages, composants et modules affichés.

const ROOT = join(__dirname, "../../..");

type Messages = { [key: string]: string | Messages };
function flatten(messages: Messages, prefix = ""): Record<string, string> {
  return Object.fromEntries(
    Object.entries(messages).flatMap(([key, value]) =>
      typeof value === "string" ? [[`${prefix}${key}`, value]] : Object.entries(flatten(value, `${prefix}${key}.`)),
    ),
  );
}
// Variables ICU d'un message : `{count}`, `{count, plural, …}`, `<link>…</link>`.
const variables = (message: string) => [...new Set([...message.matchAll(/\{\s*(\w+)\s*[,}]|<(\w+)>/g)].map((m) => m[1] ?? `<${m[2]}>`))].sort();

describe("messages", () => {
  const frKeys = flatten(fr as Messages);
  const enKeys = flatten(en as Messages);

  it("ont les mêmes clés en français et en anglais", () => {
    expect(Object.keys(enKeys).sort()).toEqual(Object.keys(frKeys).sort());
  });

  it("ont les mêmes variables dans les deux langues, et aucune traduction vide", () => {
    for (const [key, message] of Object.entries(frKeys)) {
      expect(variables(enKeys[key] ?? ""), key).toEqual(variables(message));
      expect(message.trim(), key).not.toBe("");
      expect((enKeys[key] ?? "").trim(), key).not.toBe("");
    }
  });
});

// Textes permis en dur : marque, symboles, exemples de saisie neutres.
const ALLOWED = new Set(["Pipeline AI", "Pipeline AI · ", "#FFD400, #000000", "35-45"]);
const TEXT_ATTRIBUTES = new Set(["aria-label", "title", "placeholder", "alt", "label", "hint", "description", "accessibleLabel", "empty", "saved", "aria-description"]);
// Textes techniques, jamais affichés : erreurs internes (super, Error), messages de réparation adressés
// au modèle (addIssue), préfixes des erreurs de base de données (rpc, failure, throwReservationError).
// Journaux (console.warn…), alertes Sentry (captureMessage) et messages d'une ligne marquée `i18n-ignore` : même raison.
const SKIP_CALLS = new Set([
  "t", "cn", "cva", "querySelector", "querySelectorAll", "Error", "require", "import", "super", "addIssue", "rpc", "failure", "throwReservationError",
  "log", "info", "warn", "error", "captureMessage",
]);
// Fichiers rendus hors du fournisseur next-intl : la page d'erreur globale porte ses deux langues,
// l'image de partage est générée au build, sans langue d'interface.
const EXEMPT_FILES = new Set(["src/app/global-error.tsx", "src/app/opengraph-image.tsx"]);

function files(dir: string, extension: RegExp, skip: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (skip.test(path)) return [];
    return statSync(path).isDirectory() ? files(path, extension, skip) : extension.test(path) ? [path] : [];
  });
}

const hasLetters = (text: string) => /\p{L}{2,}/u.test(text);
// Liste de classes Tailwind : la plupart des mots portent un tiret, deux-points, crochet ou barre.
const looksLikeClasses = (text: string) => {
  const tokens = text.trim().split(/\s+/);
  return tokens.filter((token) => /[-:[\]/]/.test(token)).length >= tokens.length / 2;
};
// Phrase d'interface : au moins deux mots, et pas une liste de classes ni un chemin.
const looksLikeSentence = (text: string) => /\p{L}{2,}\s+\p{L}{2,}/u.test(text) && !looksLikeClasses(text) && !text.startsWith("/");
const looksFrench = (text: string) => /[éèêàùçôîâû]|\b(le|la|les|des|du|une?|vos?|votre|est|sont|pas|pour|avec|dans|sur)\b/i.test(text);

function skipped(node: ts.Node): boolean {
  for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxAttribute(parent) && ["className", "style", "href", "key", "type", "name", "id", "value", "variant"].includes(parent.name.getText())) return true;
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && SKIP_CALLS.has(parent.expression.getText().split(".").pop() ?? "")) return true;
    if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
    if (ts.isExpressionStatement(parent) && ts.isStringLiteral(parent.expression)) return true; // "use client"
  }
  return false;
}

function violations(file: string, { jsx, frenchOnly }: { jsx: boolean; frenchOnly: boolean }): string[] {
  if (EXEMPT_FILES.has(relative(ROOT, file))) return [];
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const report = (node: ts.Node, text: string) => {
    if (ALLOWED.has(text.trim())) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart());
    if (lines[line - 1]?.includes("i18n-ignore")) return;
    found.push(`${relative(ROOT, file)}:${line + 1} « ${text.trim().slice(0, 60)} »`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && hasLetters(node.text)) report(node, node.text);
    else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && TEXT_ATTRIBUTES.has(node.name.getText()) && hasLetters(node.initializer.text)) {
      report(node, node.initializer.text);
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !ts.isJsxAttribute(node.parent) && !skipped(node)) {
      if (looksLikeSentence(node.text) && (!frenchOnly || looksFrench(node.text))) report(node, node.text);
    } else if (ts.isTemplateExpression(node) && !skipped(node)) {
      const text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
      if (looksLikeSentence(text) && looksFrench(text)) report(node, text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("textes d'interface", () => {
  it("ne laisse aucun texte en dur dans les pages et les composants", () => {
    const tsx = [...files(join(ROOT, "src/app"), /\.tsx$/, /\/api\//), ...files(join(ROOT, "src/components"), /\.tsx$/, /\/ui\//)];
    expect(tsx.flatMap((file) => violations(file, { jsx: true, frenchOnly: false }))).toEqual([]);
  });

  it("ne laisse aucune phrase française dans les modules qui produisent du texte affiché", () => {
    // Exclus : contenus d'exemple (démonstrations), prompts et schémas du modèle (anglais), journaux.
    const lib = [
      ...files(join(ROOT, "src/lib"), /\.ts$/, /\/(demo|ai|observability|supabase)\//),
      ...files(join(ROOT, "src/app"), /\.ts$/, /\/api\/(inngest|webhooks)\//),
    ];
    expect(lib.flatMap((file) => violations(file, { jsx: false, frenchOnly: true }))).toEqual([]);
  });
});
