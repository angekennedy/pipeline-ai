import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { ASSET_TYPES } from "@/lib/ai/schemas";
import { assetCredits, pipelineCredits } from "@/lib/billing/costs";
import { CREDIT_PACKS, PLAN_KEYS, PLANS, formatCredits, formatEuros, type Plan } from "@/lib/billing/plans";
import { ASSET_LABELS } from "@/lib/pipeline/labels";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Tarifs · Pipeline AI" };

// Grille de crédits (ARCHITECTURE §5.1), en clair : la formule de chaque asset et quelques exemples.
const RULES: Record<(typeof ASSET_TYPES)[number], string> = {
  script: "4 + 1 par minute (Premium : 8 + 2 par minute)",
  titles: "1",
  seo: "2",
  voiceover: "2 + 1 par tranche de 10 min",
  thumbnails: "1",
};
const TEN_MINUTES = pipelineCredits({ durationMinutes: 10 }, "standard");
const EXAMPLES = [
  { label: "Vidéo de 10 min, Standard", credits: TEN_MINUTES },
  { label: "Vidéo de 10 min, Premium", credits: pipelineCredits({ durationMinutes: 10 }, "premium") },
  { label: "Vidéo de 30 min, Standard", credits: pipelineCredits({ durationMinutes: 30 }, "standard") },
];

function features(plan: Plan) {
  return [
    `Environ ${Math.floor(plan.credits / TEN_MINUTES)} vidéos de 10 min`,
    `Vidéos jusqu'à ${plan.maxDurationMinutes} min`,
    plan.premium ? "Script Premium (Claude Opus)" : "Script Standard (Claude Sonnet)",
    `${plan.channelPresets} ${plan.channelPresets > 1 ? "presets de chaîne" : "preset de chaîne"}`,
    `${plan.seats} ${plan.seats > 1 ? "sièges" : "siège"}`,
  ];
}

export default function PricingPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Tarifs</h1>
      <p className="mt-1 mb-8 max-w-2xl text-muted-foreground">
        Chaque asset coûte des crédits selon la durée de la vidéo. Le coût s&apos;affiche avant chaque lancement, et seuls les assets réussis sont
        débités.
      </p>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Plans">
        {PLAN_KEYS.map((key) => {
          const plan = PLANS[key];
          return (
            <li key={key} className="flex flex-col rounded-xl border p-5">
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{plan.pitch}</p>
              <p className="mt-4 text-3xl font-semibold tabular-nums">
                {formatEuros(plan.priceEurCents)}
                {plan.renewal === "monthly" && <span className="text-sm font-normal text-muted-foreground"> / mois</span>}
              </p>
              <p className="mt-1 text-sm font-medium">
                {formatCredits(plan.credits)} {plan.renewal === "monthly" ? "par mois" : "offerts"}
              </p>
              <ul className="mt-4 grid flex-1 content-start gap-2 text-sm">
                {features(plan).map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    {feature}
                  </li>
                ))}
              </ul>
              {key === "free" ? (
                <Link href="/pipelines/new" className={buttonVariants({ className: "mt-5" })}>
                  Commencer
                </Link>
              ) : (
                // Paiement depuis la facturation du workspace (connexion demandée au besoin).
                <Link href="/billing" className={buttonVariants({ variant: "outline", className: "mt-5" })} aria-label={`Choisir le plan ${plan.name}`}>
                  Choisir
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        Les crédits d&apos;abonnement non utilisés sont reportés, dans la limite d&apos;un mois d&apos;allocation.
      </p>

      <section aria-labelledby="packs" className="mt-12">
        <h2 id="packs" className="text-lg font-semibold">
          Packs de crédits
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Achat ponctuel, sans expiration, en complément de n&apos;importe quel plan.</p>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {CREDIT_PACKS.map((pack) => (
            <li key={pack.credits} className="flex items-center justify-between rounded-xl border p-4">
              <span className="font-medium">{formatCredits(pack.credits)}</span>
              <span className="tabular-nums">{formatEuros(pack.priceEurCents)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="grid" className="mt-12">
        <h2 id="grid" className="text-lg font-semibold">
          Coût de chaque asset
        </h2>
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th scope="col" className="py-2 font-medium">
                Asset
              </th>
              <th scope="col" className="py-2 font-medium">
                Crédits
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Pour 10 min
              </th>
            </tr>
          </thead>
          <tbody>
            {ASSET_TYPES.map((type) => (
              <tr key={type} className="border-t">
                <th scope="row" className="py-2 text-left font-normal">
                  {ASSET_LABELS[type]}
                </th>
                <td className="py-2">{RULES[type]}</td>
                <td className="py-2 text-right tabular-nums">{assetCredits({ durationMinutes: 10 }, "standard")[type]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-4 grid gap-1 text-sm text-muted-foreground">
          {EXAMPLES.map((example) => (
            <li key={example.label}>
              {example.label} : <span className="font-medium text-foreground tabular-nums">{formatCredits(example.credits)}</span>
            </li>
          ))}
          <li>Régénérer un asset coûte le même prix que le générer. Une édition manuelle ou une restauration est gratuite.</li>
        </ul>
      </section>
    </main>
  );
}
