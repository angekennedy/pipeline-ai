import Link from "next/link";
import { signOut } from "@/lib/auth/actions";
import { getUser } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";

// Lit la session : rendu à la requête, derrière un <Suspense> dans l'en-tête.
export async function AccountMenu() {
  const user = await getUser();
  if (!user) {
    return (
      <Link href="/login" className="text-sm font-medium hover:underline">
        Se connecter
      </Link>
    );
  }
  return (
    <form action={signOut} className="flex items-center gap-2">
      <span className="hidden max-w-40 truncate text-sm text-muted-foreground sm:inline" title={user.email ?? undefined}>
        {user.email}
      </span>
      <Button type="submit" variant="ghost" size="sm">
        Se déconnecter
      </Button>
    </form>
  );
}
