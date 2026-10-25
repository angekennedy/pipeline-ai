import "server-only";
import { cookies } from "next/headers";
import { NEXT_COOKIE, safeNext } from "./routes";

// Page demandée avant la connexion, gardée en cookie pendant la durée de validité d'un lien
// (otp_expiry, supabase/config.toml) plutôt que dans l'URL de retour : le lien de l'e-mail reste
// fixe et rien ne permet d'y glisser une redirection.
export async function rememberNext(next: FormDataEntryValue | null) {
  (await cookies()).set(NEXT_COOKIE, safeNext(typeof next === "string" ? next : null), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60,
    path: "/",
  });
}

// Lue une fois, à l'arrivée sur /auth/confirm ou /auth/callback.
export async function takeNext(): Promise<string> {
  const store = await cookies();
  const next = safeNext(store.get(NEXT_COOKIE)?.value);
  store.delete(NEXT_COOKIE);
  return next;
}
