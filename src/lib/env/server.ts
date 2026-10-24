import "server-only";
import { z } from "zod";

// Secrets serveur. Ne jamais préfixer ces variables par NEXT_PUBLIC_.
// Les variables Stripe, Inngest et Upstash seront ajoutées dans leurs phases respectives.
const ServerEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  // Surcharges facultatives des modèles par défaut de src/lib/ai/models.ts.
  MODEL_SCRIPT_STANDARD: z.string().min(1).optional(),
  MODEL_SCRIPT_PREMIUM: z.string().min(1).optional(),
  MODEL_LIGHT: z.string().min(1).optional(),
});

export const serverEnv = ServerEnvSchema.parse(process.env);
