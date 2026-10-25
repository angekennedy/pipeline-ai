"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { rememberNext } from "@/lib/auth/next-cookie";
import { createClient } from "@/lib/supabase/server";

export type MagicLinkState = { status: "idle" | "sent" | "error"; email: string; message?: string };

const EmailSchema = z.email();

// Lien magique : Supabase crée le compte s'il n'existe pas. La réponse est la même dans les deux cas,
// sans révéler si une adresse est inscrite.
export async function sendMagicLink(_previous: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim() : "";
  if (!EmailSchema.safeParse(email).success) {
    return { status: "error", email, message: "Saisissez une adresse e-mail valide." };
  }

  await rememberNext(formData.get("next"));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) {
    const message =
      error.status === 429
        ? "Trop de demandes de lien. Patientez quelques minutes avant de réessayer."
        : "L'envoi du lien a échoué. Réessayez dans un instant.";
    return { status: "error", email, message };
  }
  return { status: "sent", email };
}

// Connexion Google (OAuth, PKCE) : Supabase renvoie vers /auth/callback avec un code. L'origine vient
// de l'en-tête Origin, que Next compare déjà à l'hôte pour chaque Server Action.
export async function signInWithGoogle(formData: FormData) {
  await rememberNext(formData.get("next"));
  const origin = (await headers()).get("origin");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (error || !data.url) redirect("/login?error=google");
  redirect(data.url);
}
