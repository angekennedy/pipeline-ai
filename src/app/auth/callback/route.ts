import { NextResponse, type NextRequest } from "next/server";
import { takeNext } from "@/lib/auth/next-cookie";
import { createClient } from "@/lib/supabase/server";

// Retour de Google (OAuth) : le code s'échange contre une session avec le vérificateur PKCE posé en
// cookie par signInWithGoogle.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(await takeNext(), request.url));
  }
  return NextResponse.redirect(new URL("/login?error=google", request.url));
}
