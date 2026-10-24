import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env/server";

let client: Anthropic | undefined;

export function getAnthropic(): Anthropic {
  client ??= new Anthropic({
    apiKey: serverEnv.ANTHROPIC_API_KEY,
    // Le SDK relance déjà les 408, 409, 429, 5xx et les erreurs réseau. On reste bas :
    // les étapes Inngest ajoutent leurs propres relances.
    maxRetries: 2,
    timeout: 10 * 60 * 1000,
  });
  return client;
}
