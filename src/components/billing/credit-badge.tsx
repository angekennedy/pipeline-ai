import Link from "next/link";
import { Coins } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CreditSummary } from "@/lib/billing/balance";
import { PLANS } from "@/lib/billing/plans";

// Solde disponible du workspace, dans l'en-tête : un lien vers la facturation pour en racheter.
export function CreditBadge({ credits }: { credits: CreditSummary }) {
  const t = useTranslations();
  const plan = PLANS[credits.planKey];
  const available = credits.unlimited ? t("CreditBadge.unlimited") : t("Common.credits", { count: credits.available });
  return (
    <Link
      href="/billing"
      aria-label={t("CreditBadge.label", { credits: available, plan: plan.name })}
      title={credits.reserved > 0 ? t("CreditBadge.reserved", { credits: t("Common.credits", { count: credits.reserved }) }) : undefined}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm tabular-nums hover:bg-muted"
    >
      <Coins aria-hidden="true" className="size-3.5 text-muted-foreground" />
      {available}
      <span className="text-xs text-muted-foreground">· {plan.name}</span>
    </Link>
  );
}
