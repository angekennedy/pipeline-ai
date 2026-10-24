import "server-only";
import { z } from "zod";

// Secrets serveur. Ne jamais préfixer ces variables par NEXT_PUBLIC_.
// Les variables Anthropic, Stripe, Inngest et Upstash seront ajoutées dans leurs phases respectives.
const ServerEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
});

export const serverEnv = ServerEnvSchema.parse(process.env);
