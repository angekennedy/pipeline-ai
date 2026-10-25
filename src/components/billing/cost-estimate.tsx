import { ASSET_TYPES } from "@/lib/ai/schemas";
import { assetCredits } from "@/lib/billing/costs";
import { formatCredits } from "@/lib/billing/plans";
import { ASSET_LABELS } from "@/lib/pipeline/labels";
import type { ModelTier } from "@/lib/pipeline/registry";

// Coût d'un pipeline avant le lancement : total réservé, détail par asset et solde restant.
// Rien n'est affiché pour une durée invalide, que la validation du formulaire signale déjà.
export function CostEstimate({ durationMinutes, tier, available }: { durationMinutes: number; tier: ModelTier; available: number }) {
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 60) return null;
  const costs = assetCredits({ durationMinutes }, tier);
  const total = ASSET_TYPES.reduce((sum, type) => sum + costs[type], 0);
  const remaining = available - total;

  return (
    <section aria-labelledby="cost-estimate" className="rounded-xl border p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="cost-estimate" className="font-medium">
          Coût : <span className="tabular-nums">{formatCredits(total)}</span>
        </h2>
        <p className={remaining < 0 ? "text-destructive" : "text-muted-foreground"}>
          {remaining < 0
            ? `Il vous manque ${formatCredits(-remaining)} (${formatCredits(available)} disponibles).`
            : `Solde après le lancement : ${formatCredits(remaining)}.`}
        </p>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        {ASSET_TYPES.map((type) => (
          <li key={type}>
            {ASSET_LABELS[type]} <span className="tabular-nums">{costs[type]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Les crédits sont réservés au lancement et seuls les assets réussis sont débités : le reste est rendu.
      </p>
    </section>
  );
}
