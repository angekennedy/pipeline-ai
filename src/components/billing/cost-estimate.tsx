import { useTranslations } from "next-intl";
import { ASSET_TYPES } from "@/lib/ai/schemas";
import { assetCredits } from "@/lib/billing/costs";
import type { ModelTier } from "@/lib/pipeline/registry";

// Coût d'un pipeline avant le lancement : total réservé, détail par asset et solde restant.
// Rien n'est affiché pour une durée invalide, que la validation du formulaire signale déjà.
export function CostEstimate({ durationMinutes, tier, available }: { durationMinutes: number; tier: ModelTier; available: number }) {
  const t = useTranslations("CostEstimate");
  const all = useTranslations();
  const credits = (count: number) => all("Common.credits", { count });
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 60) return null;
  const costs = assetCredits({ durationMinutes }, tier);
  const total = ASSET_TYPES.reduce((sum, type) => sum + costs[type], 0);
  const remaining = available - total;

  return (
    <section aria-labelledby="cost-estimate" className="rounded-xl border p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="cost-estimate" className="font-medium">
          {t.rich("cost", { total: () => <span className="tabular-nums">{credits(total)}</span> })}
        </h2>
        <p className={remaining < 0 ? "text-destructive" : "text-muted-foreground"}>
          {remaining < 0
            ? t("missing", { missing: credits(-remaining), available: credits(available) })
            : t("after", { remaining: credits(remaining) })}
        </p>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        {ASSET_TYPES.map((type) => (
          <li key={type}>
            {all(`Labels.assets.${type}`)} <span className="tabular-nums">{costs[type]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("note")}
      </p>
    </section>
  );
}
