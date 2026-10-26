import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

// Connexion d'un utilisateur de test sans passer par une boîte mail : l'API admin génère le jeton du
// lien magique, et le navigateur ouvre /auth/confirm comme depuis l'e-mail. Les variables viennent du
// Supabase local (playwright.config.ts).
function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase local requis pour les parcours connectés : lancer `pnpm db:start`.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const testEmail = () => `e2e-${randomUUID().slice(0, 8)}@test.local`;

// Utilisateurs créés par signIn, pour les données préparées ensuite (tests/e2e/pipelines.ts).
const users = new Map<string, string>();
export function userIdFor(email: string): string {
  const id = users.get(email);
  if (!id) throw new Error(`Utilisateur inconnu : ${email} (connecter d'abord avec signIn)`);
  return id;
}

export async function magicLinkPath(email: string) {
  const { data, error } = await admin().auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  return `/auth/confirm?token_hash=${data.properties.hashed_token}&type=email`;
}

// Le trigger d'inscription crée le workspace personnel et ses 30 crédits Free. `reserved` simule un
// pipeline en cours qui en bloque une partie, par la vraie RPC de réservation.
export async function signIn(page: Page, { email = testEmail(), reserved = 0 }: { email?: string; reserved?: number } = {}) {
  const db = admin();
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  users.set(email, data.user.id);
  if (reserved > 0) {
    const { data: membership } = await db.from("workspace_members").select("workspace_id").eq("user_id", data.user.id).single();
    const { error: rpcError } = await db.rpc("create_pipeline_with_reservation", {
      p_workspace: membership!.workspace_id,
      p_user: data.user.id,
      p_brief: { niche: "Histoire", topic: "Pipeline en cours", language: "fr", tone: "educational", style: "documentary", durationMinutes: 5 },
      p_tier: "standard",
      p_credits: reserved,
      p_key: randomUUID(),
    });
    if (rpcError) throw rpcError;
  }
  await page.goto(await magicLinkPath(email));
  return email;
}
