import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { publicEnv } from "@/lib/env/public";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("login"), robots: { index: false } };
}

export default function LoginPage() {
  const t = useTranslations("Login");
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-1 mb-8 text-muted-foreground">{t("intro")}</p>
      {/* La destination (`next`) et l'erreur éventuelle sont dans l'URL, lue à la requête. */}
      <Suspense>
        <LoginForm googleEnabled={publicEnv.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED} />
      </Suspense>
    </main>
  );
}
