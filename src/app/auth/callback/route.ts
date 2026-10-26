import { after, NextResponse, type NextRequest } from "next/server";
import { isNewAccount, track } from "@/lib/analytics/posthog";
import { inviteOnly } from "@/lib/beta";
import { createAdminClient } from "@/lib/supabase/admin";
import { takeNext } from "@/lib/auth/next-cookie";
import { createClient } from "@/lib/supabase/server";

// Retour de Google (OAuth) : le code s'échange contre une session avec le vérificateur PKCE posé en
// cookie par signInWithGoogle.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const user = data.user;
      if (user && isNewAccount(user.created_at)) after(() => track(user.id, { name: "signed_up", properties: { method: "google" } }, user.id));
      return NextResponse.redirect(new URL(await takeNext(), request.url));
    }
  }
  // Bêta fermée (tâche 5.6) : le trigger beta_gate refuse le compte, Supabase revient avec une erreur
  // générique. En mode bêta, c'est l'invitation qui manque.
  const refused = request.nextUrl.searchParams.has("error") && (await inviteOnly(createAdminClient()));
  return NextResponse.redirect(new URL(`/login?error=${refused ? "invite" : "google"}`, request.url));
}
