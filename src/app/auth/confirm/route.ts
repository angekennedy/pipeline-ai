import type { EmailOtpType } from "@supabase/supabase-js";
import { after, NextResponse, type NextRequest } from "next/server";
import { isNewAccount, track } from "@/lib/analytics/posthog";
import { takeNext } from "@/lib/auth/next-cookie";
import { createClient } from "@/lib/supabase/server";

// Arrivée depuis le lien magique : le gabarit d'e-mail (supabase/templates/magic-link.html) pointe ici
// avec le jeton haché. La vérification se fait côté serveur, donc le lien marche aussi ouvert sur un
// autre appareil que celui qui l'a demandé.
const TYPES: ReadonlySet<EmailOtpType> = new Set(["email", "magiclink", "signup"]);

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type && TYPES.has(type)) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      const user = data.user;
      if (user && isNewAccount(user.created_at)) after(() => track(user.id, { name: "signed_up", properties: { method: "email" } }, user.id));
      return NextResponse.redirect(new URL(await takeNext(), request.url));
    }
  }
  return NextResponse.redirect(new URL("/login?error=lien", request.url));
}
