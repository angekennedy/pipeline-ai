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

export async function magicLinkPath(email: string) {
  const { data, error } = await admin().auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  return `/auth/confirm?token_hash=${data.properties.hashed_token}&type=email`;
}

export async function signIn(page: Page, email = testEmail()) {
  await admin().auth.admin.createUser({ email, email_confirm: true });
  await page.goto(await magicLinkPath(email));
  return email;
}
