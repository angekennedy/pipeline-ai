import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { CreditBadge } from "@/components/billing/credit-badge";
import { DEMO_CREDITS } from "@/lib/demo/credits";
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
          <nav className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-3" aria-label="Navigation principale">
            <Link href="/" className="font-semibold">
              Pipeline AI
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground">
                Tarifs
              </Link>
              <Link href="/pipelines/new" className="text-sm text-muted-foreground hover:text-foreground">
                Nouveau pipeline
              </Link>
              {/* Mode démo : le solde du workspace courant viendra avec l'authentification (phase 2). */}
              <CreditBadge credits={DEMO_CREDITS} />
            </div>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
