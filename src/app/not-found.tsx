import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

// Page absente, ou appartenant à un workspace dont l'utilisateur n'est pas membre : même réponse,
// qui ne dit pas si la ressource existe.
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 text-center">
      <h1 className="text-xl font-semibold">Page introuvable</h1>
      <p className="mt-1 text-muted-foreground">Cette page n&apos;existe pas, ou vous n&apos;y avez pas accès.</p>
      <Link href="/" className={buttonVariants({ className: "mt-6" })}>
        Retour à l&apos;accueil
      </Link>
    </main>
  );
}
