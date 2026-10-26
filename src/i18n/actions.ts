"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { LOCALE_COOKIE, isLocale } from "./locales";

const ONE_YEAR = 60 * 60 * 24 * 365;

// Sélecteur de langue : un cookie, lu par src/i18n/request.ts à chaque requête. Connecté, la langue est
// aussi gardée dans le profil (RLS own_profile), pour les futurs e-mails.
export async function changeLocale(formData: FormData) {
  const raw = formData.get("locale");
  const locale = typeof raw === "string" ? raw : null;
  if (!isLocale(locale)) throw new Error(`Langue inconnue : ${String(raw)}`);
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
  const user = await getUser();
  if (user) {
    const { error } = await (await createClient()).from("profiles").update({ locale }).eq("id", user.id);
    if (error) throw new Error(`Langue du profil ${user.id} : ${error.message}`);
  }
  refresh();
}
