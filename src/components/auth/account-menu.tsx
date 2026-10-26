import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { signOut } from "@/lib/auth/actions";
import { getUser } from "@/lib/auth/session";
import { getCurrentWorkspace } from "@/lib/workspaces/current";
import { CreditBadge } from "@/components/billing/credit-badge";
import { Button } from "@/components/ui/button";

// Lit la session : rendu à la requête, derrière un <Suspense> dans l'en-tête. Connecté, l'utilisateur
// voit le solde de son workspace.
export async function AccountMenu() {
  const [user, t] = await Promise.all([getUser(), getTranslations("Account")]);
  if (!user) {
    return (
      <Link href="/login" className="text-sm font-medium hover:underline">
        {t("signIn")}
      </Link>
    );
  }
  const workspace = await getCurrentWorkspace();
  return (
    <form action={signOut} className="flex flex-wrap items-center gap-2">
      {workspace && <CreditBadge credits={workspace.credits} />}
      <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground" title={user.email ?? undefined}>
        <span className="hidden max-w-40 truncate align-bottom sm:inline-block">{user.email}</span>
        <span className="sm:hidden">{t("account")}</span>
      </Link>
      <Button type="submit" variant="ghost" size="sm">
        {t("signOut")}
      </Button>
    </form>
  );
}
