import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { LOGIN_PATH } from "./routes";

// Couche d'accès aux données pour l'utilisateur courant (guide Next « Authentication », DAL) : la
// seule lecture de session des pages et Server Actions. getClaims vérifie la signature du JWT, sans
// faire confiance au cookie tel quel. Une lecture par requête (cache React).

export type SessionUser = { id: string; email: string | null };

export const getUser = cache(async (): Promise<SessionUser | null> => {
  // Le client Supabase lit l'heure (expiration du jeton) dès sa création : sans connection(), Next le
  // signale pendant le prérendu à la requête (blocking-prerender-current-time).
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
});

// Pages et Server Actions de l'application : sans session, retour à la connexion, puis à `next`.
export async function requireUser(next?: string): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect(next ? `${LOGIN_PATH}?next=${encodeURIComponent(next)}` : LOGIN_PATH);
  return user;
}
