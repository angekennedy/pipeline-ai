// Tout texte venu d'un utilisateur (brief, preset de chaîne, feedback) ou d'une sortie de modèle
// dérivée de ce texte passe par renderUntrusted() avant d'entrer dans un prompt. Les consignes
// système demandent de traiter ces blocs comme des données (voir UNTRUSTED_DATA_POLICY).

const TAG_NAME = /^[a-z][a-z_]*$/;

// Caractères invisibles qui servent à cacher des instructions : caractères de contrôle (sauf \t et \n),
// espaces de largeur nulle, contrôles bidirectionnels, bloc Unicode « Tags ». ZWJ et ZWNJ sont
// conservés : les emojis composés et plusieurs écritures en ont besoin.
const INVISIBLE = /[\u0000-\u0008\u000B-\u001F\u007F​⁠﻿‪-‮⁦-⁩\u{E0000}-\u{E007F}]/gu;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

const clean = (text: string) => text.normalize("NFC").replace(INVISIBLE, "");

function normalize(value: unknown): unknown {
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

// Sérialisation déterministe : mêmes données, mêmes octets, quel que soit l'ordre des clés
// (jsonb ne le conserve pas). Condition pour que le préfixe d'un prompt reste en cache.
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function renderUntrusted(tag: string, value: unknown): string {
  if (!TAG_NAME.test(tag)) throw new Error(`Nom de balise invalide : ${JSON.stringify(tag)}`);
  // Les invisibles sont retirés chaîne par chaîne avant la sérialisation (JSON écrirait `\u0000`
  // en toutes lettres) ; < > & sont échappés après, JSON ne les touchant pas.
  const body = (typeof value === "string" ? clean(value) : stableStringify(value)).replace(/[&<>]/g, (c) => ESCAPES[c]!);
  return `<${tag}>\n${body}\n</${tag}>`;
}
