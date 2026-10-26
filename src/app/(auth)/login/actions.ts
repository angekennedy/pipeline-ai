"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { rememberNext } from "@/lib/auth/next-cookie";
import { canSignIn } from "@/lib/beta";
import { enforceRateLimit, fingerprint, RateLimitedError, type RateLimitHit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// `error` : clé du message affiché par le formulaire (Login.errors).
export type MagicLinkState = { status: "idle" | "sent" | "error"; email: string; error?: "invalidEmail" | "disposableEmail" | "inviteOnly" | "rateLimited" | "sendFailed" };

const EmailSchema = z.email();

// Adresses jetables les plus répandues : chaque inscription reçoit des crédits offerts (tâche 4.5).
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com", "dispostable.com", "emailondeck.com", "fakeinbox.com", "getnada.com", "guerrillamail.com",
  "guerrillamail.net", "mailinator.com", "maildrop.cc", "mailnesia.com", "mohmal.com", "sharklasers.com",
  "temp-mail.org", "tempail.com", "tempmail.com", "throwawaymail.com", "trashmail.com", "yopmail.com", "yopmail.fr",
]);

const isDisposable = (email: string) => DISPOSABLE_DOMAINS.has(email.slice(email.lastIndexOf("@") + 1).toLowerCase());

// Première adresse de X-Forwarded-For : celle du client, posée par le proxy de Vercel.
async function clientIp(): Promise<string | null> {
  const forwarded = (await headers()).get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || null;
}

// Lien magique : Supabase crée le compte s'il n'existe pas. La réponse est la même dans les deux cas,
// sans révéler si une adresse est inscrite. Limité par adresse et par IP, avant l'envoi.
export async function sendMagicLink(_previous: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim() : "";
  if (!EmailSchema.safeParse(email).success) {
    return { status: "error", email, error: "invalidEmail" };
  }
  if (isDisposable(email)) return { status: "error", email, error: "disposableEmail" };

  const ip = await clientIp();
  const hits: RateLimitHit[] = [{ rule: "loginEmail", subject: fingerprint(email) }];
  if (ip) hits.push({ rule: "loginIp", subject: fingerprint(ip) });
  const admin = createAdminClient();
  try {
    await enforceRateLimit(admin, hits);
  } catch (error) {
    if (error instanceof RateLimitedError) return { status: "error", email, error: "rateLimited" };
    throw error;
  }
  // Bêta fermée (tâche 5.6) : une adresse ni invitée ni déjà inscrite n'obtient pas de lien. Ce refus
  // révèle qu'une adresse n'a pas de compte ; la limite de fréquence ci-dessus borne ces essais.
  if (!(await canSignIn(admin, email))) return { status: "error", email, error: "inviteOnly" };

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
