import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { AccountMenu } from "@/components/auth/account-menu";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pipeline AI",
  description: "Du brief à la vidéo faceless prête à produire : script, titres, SEO, voix off et miniatures.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b">
          <nav className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3" aria-label="Navigation principale">
            <Link href="/" className="font-semibold">
              Pipeline AI
            </Link>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground">
                Tarifs
              </Link>
              <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
                Mes pipelines
              </Link>
              <Link href="/pipelines/new" className="text-sm text-muted-foreground hover:text-foreground">
                Nouveau pipeline
              </Link>
              {/* Le menu dépend de la session : en attendant, un emplacement de la taille du lien de
                  connexion, pour que les liens voisins ne se décalent pas (CLS). */}
              <Suspense
                fallback={
                  <span aria-hidden="true" className="invisible text-sm font-medium">
                    Se connecter
                  </span>
                }
              >
                <AccountMenu />
              </Suspense>
            </div>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
