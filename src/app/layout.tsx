import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SiteFooter } from "@/components/site-footer";
import { AccountMenu } from "@/components/auth/account-menu";
import { siteUrl } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Métadonnées par défaut de toutes les pages (tâche 5.1) : base des URL absolues, carte de partage.
// L'image vient de `opengraph-image.tsx` ; titre et description, de chaque page.
export async function generateMetadata(): Promise<Metadata> {
  const [locale, description] = await Promise.all([getLocale(), getTranslations("Home").then((t) => t("tagline"))]);
  return {
    metadataBase: siteUrl(),
    title: "Pipeline AI",
    description,
    openGraph: { type: "website", siteName: "Pipeline AI", locale: locale === "en" ? "en_US" : "fr_FR", description },
    twitter: { card: "summary_large_image" },
  };
}

// La langue de l'interface vient de la requête (cookie, Accept-Language) : chaque page est rendue à la
// requête, dans la langue de l'utilisateur (src/i18n/request.ts).
export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, t, account] = await Promise.all([getLocale(), getTranslations("Header"), getTranslations("Account")]);
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
        <header className="border-b">
          <nav className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3" aria-label={t("nav")}>
            <Link href="/" className="font-semibold">
              Pipeline AI
            </Link>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground">
                {t("pricing")}
              </Link>
              <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
                {t("dashboard")}
              </Link>
              <Link href="/pipelines/new" className="text-sm text-muted-foreground hover:text-foreground">
                {t("newPipeline")}
              </Link>
              {/* Le menu dépend de la session : en attendant, un emplacement de la taille du lien de
                  connexion, pour que les liens voisins ne se décalent pas (CLS). */}
              <Suspense
                fallback={
                  <span aria-hidden="true" className="invisible text-sm font-medium">
                    {account("signIn")}
                  </span>
                }
              >
                <AccountMenu />
              </Suspense>
              <LocaleSwitcher />
            </div>
          </nav>
        </header>
        {children}
        <SiteFooter />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
