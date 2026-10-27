import "server-only";
import { serverEnv } from "@/lib/env/server";
import { OpenAIClient } from "./openai";

let client: OpenAIClient | undefined;

export function getOpenAI(): OpenAIClient {
  client ??= new OpenAIClient({
    apiKey: serverEnv.OPENAI_API_KEY,
    // Le client relance déjà les 408, 409, 429, 5xx et les erreurs réseau. On reste bas :
    // les étapes Inngest ajoutent leurs propres relances.
    maxRetries: 2,
    timeout: 10 * 60 * 1000,
  });
  return client;
}
