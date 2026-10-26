import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Compte supprimé · Pipeline AI", robots: { index: false } };

export default function AccountDeletedPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-4 px-4 py-20 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Compte supprimé</h1>
      <p className="text-muted-foreground">
        Votre compte, vos workspaces et leur contenu ont été effacés. Vous pouvez créer un nouveau compte à tout moment.
      </p>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        Retour à l&apos;accueil
      </Link>
    </main>
  );
}
