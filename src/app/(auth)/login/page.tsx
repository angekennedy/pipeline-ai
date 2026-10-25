import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { publicEnv } from "@/lib/env/public";

export const metadata: Metadata = { title: "Connexion · Pipeline AI", robots: { index: false } };

export default function LoginPage() {
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Connexion</h1>
      <p className="mt-1 mb-8 text-muted-foreground">Recevez un lien de connexion par e-mail : pas de mot de passe à retenir.</p>
      {/* La destination (`next`) et l'erreur éventuelle sont dans l'URL, lue à la requête. */}
      <Suspense>
        <LoginForm googleEnabled={publicEnv.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED} />
      </Suspense>
    </main>
  );
}
