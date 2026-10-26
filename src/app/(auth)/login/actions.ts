"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { rememberNext } from "@/lib/auth/next-cookie";
import { createClient } from "@/lib/supabase/server";

// `error` : clé du message affiché par le formulaire (Login.errors).
export type MagicLinkState = { status: "idle" | "sent" | "error"; email: string; error?: "invalidEmail" | "rateLimited" | "sendFailed" };

const EmailSchema = z.email();

// Lien magique : Supabase crée le compte s'il n'existe pas. La réponse est la même dans les deux cas,
// sans révéler si une adresse est inscrite.
export async function sendMagicLink(_previous: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim() : "";
  if (!EmailSchema.safeParse(email).success) {
    return { status: "error", email, error: "invalidEmail" };
  }

  await rememberNext(formData.get("next"));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) {
    return { status: "error", email, error: error.status === 429 ? "rateLimited" : "sendFailed" };
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
