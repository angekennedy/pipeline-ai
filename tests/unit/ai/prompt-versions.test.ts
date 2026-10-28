import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prompts, type PromptContext } from "@/lib/ai/prompts";
import { ASSET_TYPES } from "@/lib/ai/schemas";
import { stableStringify } from "@/lib/security/untrusted";
import { validBrief, validChannel, validScript, validTitles } from "../../fixtures/assets";

// Empreinte du prompt rendu pour chaque version publiée. `generations.prompt_version` doit désigner
// un texte unique : les évaluations et les taux d'échec Zod sont comparés par version.
// Prompt modifié → incrémenter `version` dans le template, puis ajouter ici la nouvelle empreinte
// (affichée par l'échec du test). Ne jamais modifier l'empreinte d'une version existante.
const FINGERPRINTS: Record<string, string> = {
  "script@1": "55372ba03e453cee",
  "titles@1": "03a247a78dbd7eff",
  "seo@1": "2284d9e63c71b0f0",
  "voiceover@1": "c399ecf0d4a33143",
  "thumbnails@1": "fc2001bf21e61619",
  // Corrections après l'évaluation v0 (evals/RESULTS.md) : durée du script, titres, texte des miniatures.
  "script@2": "dba720e2fbddb87a",
  "titles@2": "620628b0f4061f6e",
  "thumbnails@2": "3e0f0a420f2d996d",
  // Après l'évaluation v2 : titres sans mention du script, 4 concepts de miniatures.
  "titles@3": "876c72b165ccde98",
  "thumbnails@3": "af17c6450d3e6152",
  // Passage à OpenAI : système en chaîne, message utilisateur en un seul texte (mêmes consignes).
  "script@3": "edd383ef0f5e8698",
  "titles@4": "da96b0e0c7ed084f",
  "seo@2": "407e12314085455b",
  "voiceover@2": "2f83cf075ffc2df0",
  "thumbnails@4": "9955ca0bc18224a1",
  // Valeurs de placement et de police écrites en toutes lettres (le mode non strict ne les impose pas).
  "thumbnails@5": "e8e300dfddb0977e",
};

const ctx = {
  brief: validBrief,
  channel: validChannel,
  script: validScript,
  titles: validTitles,
  feedback: "Plus court",
} as PromptContext;

const fingerprint = (value: unknown) => createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);

describe.each(ASSET_TYPES)("version du prompt %s", (type) => {
  it("correspond au texte enregistré pour cette version", () => {
    const { version, build } = prompts[type];
    const actual = fingerprint(build(ctx));
    expect(
      FINGERPRINTS[version],
      `Prompt ${version} inconnu ou modifié. Incrémentez la version et enregistrez "${version}": "${actual}".`,
    ).toBe(actual);
  });
});
