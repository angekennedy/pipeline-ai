import Link from "next/link";
import { Coins } from "lucide-react";
import type { CreditSummary } from "@/lib/billing/balance";
import { PLANS, formatCredits } from "@/lib/billing/plans";

// Solde disponible du workspace, dans l'en-tête : un lien vers les tarifs pour en racheter.
export function CreditBadge({ credits }: { credits: CreditSummary }) {
  const plan = PLANS[credits.planKey];
  const label = `${formatCredits(credits.available)} disponibles, plan ${plan.name}`;
  return (
    <Link
      href="/pricing"
      aria-label={`${label}. Voir les tarifs`}
      title={credits.reserved > 0 ? `${formatCredits(credits.reserved)} réservés par les pipelines en cours` : undefined}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm tabular-nums hover:bg-muted"
    >
      <Coins aria-hidden="true" className="size-3.5 text-muted-foreground" />
      {formatCredits(credits.available)}
      <span className="text-xs text-muted-foreground">· {plan.name}</span>
    </Link>
  );
}
