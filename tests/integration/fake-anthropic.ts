import Anthropic from "@anthropic-ai/sdk";
import type { AssetType } from "@/lib/ai/schemas";
import { validScript, validSeo, validThumbnails, validTitles, validVoiceover } from "../fixtures/assets";
import { jsonReplyStream, refusalStream } from "../mocks/anthropic";

// Client Anthropic hors réseau pour les tests d'intégration : l'asset est reconnu au rôle annoncé dans
// le prompt système, et la réponse vient des mocks streamés. `refused` simule un refus du modèle ;
// `requests` reçoit le corps de chaque requête, pour vérifier ce que le modèle a lu.
const voiceover = { ...validVoiceover, segments: [1, 2, 3, 4].map((sceneIndex) => ({ ...validVoiceover.segments[0]!, sceneIndex })) };
const ROLES: Array<[string, AssetType, unknown]> = [
  ["scriptwriter", "script", validScript],
  ["packaging strategist", "titles", validTitles],
  ["SEO specialist", "seo", validSeo],
  ["voice director", "voiceover", voiceover],
  ["thumbnail art director", "thumbnails", validThumbnails],
];

export function fakeAnthropic(refused: AssetType[] = [], requests?: Array<{ type: AssetType; body: string }>) {
  return new Anthropic({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { system: Array<{ text: string }> };
      const [, type, output] = ROLES.find(([role]) => body.system[0]!.text.includes(role))!;
      requests?.push({ type, body: String(init?.body) });
      return refused.includes(type) ? refusalStream() : jsonReplyStream(output);
    },
  });
}

