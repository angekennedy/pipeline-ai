import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { PRICE } from "@/i18n/format";
import { ASSET_TYPES } from "@/lib/ai/schemas";
import { assetCredits, pipelineCredits } from "@/lib/billing/costs";
import { CREDIT_PACKS, PLAN_KEYS, PLANS, type Plan } from "@/lib/billing/plans";
import { buttonVariants } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("pricing"), alternates: { canonical: "/pricing" } };
}

// Grille de crédits (ARCHITECTURE §5.1), en clair : la formule de chaque asset (Pricing.rule) et
// quelques exemples.
const TEN_MINUTES = pipelineCredits({ durationMinutes: 10 }, "standard");
const EXAMPLES = [
  { key: "tenStandard", credits: TEN_MINUTES },
  { key: "tenPremium", credits: pipelineCredits({ durationMinutes: 10 }, "premium") },
  { key: "thirtyStandard", credits: pipelineCredits({ durationMinutes: 30 }, "standard") },
] as const;

export default async function PricingPage() {
  const [t, all, format] = await Promise.all([getTranslations("Pricing"), getTranslations(), getFormatter()]);
  const credits = (count: number) => all("Common.credits", { count });
  const features = (plan: Plan) => [
    t("feature.videos", { count: Math.floor(plan.credits / TEN_MINUTES) }),
    t("feature.duration", { max: plan.maxDurationMinutes }),
    plan.premium ? t("feature.premium") : t("feature.standard"),
    t("feature.presets", { count: plan.channelPresets }),
    t("feature.seats", { count: plan.seats }),
  ];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-1 mb-8 max-w-2xl text-muted-foreground">{t("intro")}</p>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("plans")}>
        {PLAN_KEYS.map((key) => {
          const plan = PLANS[key];
          return (
            <li key={key} className="flex flex-col rounded-xl border p-5">
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{all(`Plans.pitch.${key}`)}</p>
              <p className="mt-4 text-3xl font-semibold tabular-nums">
                {format.number(plan.priceEurCents / 100, PRICE)}
                {plan.renewal === "monthly" && <span className="text-sm font-normal text-muted-foreground">{t("perMonth")}</span>}
              </p>
              <p className="mt-1 text-sm font-medium">{t(plan.renewal === "monthly" ? "monthly" : "once", { credits: credits(plan.credits) })}</p>
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
                  {t("start")}
                </Link>
              ) : (
                // Paiement depuis la facturation du workspace (connexion demandée au besoin).
                <Link
                  href="/billing"
                  className={buttonVariants({ variant: "outline", className: "mt-5" })}
                  aria-label={t("choosePlan", { plan: plan.name })}
                >
                  {t("choose")}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">{t("taxes")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("carryOver")}</p>

      <section aria-labelledby="packs" className="mt-12">
        <h2 id="packs" className="text-lg font-semibold">
          {t("packs")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("packsIntro")}</p>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {CREDIT_PACKS.map((pack) => (
            <li key={pack.credits} className="flex items-center justify-between rounded-xl border p-4">
              <span className="font-medium">{credits(pack.credits)}</span>
              <span className="tabular-nums">{format.number(pack.priceEurCents / 100, PRICE)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="grid" className="mt-12">
        <h2 id="grid" className="text-lg font-semibold">
          {t("grid")}
        </h2>
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th scope="col" className="py-2 font-medium">
                {t("col.asset")}
              </th>
              <th scope="col" className="py-2 font-medium">
                {t("col.credits")}
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                {t("col.tenMinutes")}
              </th>
            </tr>
          </thead>
          <tbody>
            {ASSET_TYPES.map((type) => (
              <tr key={type} className="border-t">
                <th scope="row" className="py-2 text-left font-normal">
                  {all(`Labels.assets.${type}`)}
                </th>
                <td className="py-2">{t(`rule.${type}`)}</td>
                <td className="py-2 text-right tabular-nums">{assetCredits({ durationMinutes: 10 }, "standard")[type]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-4 grid gap-1 text-sm text-muted-foreground">
          {EXAMPLES.map((example) => (
            <li key={example.key}>
              {t.rich("example", {
                label: t(`examples.${example.key}`),
                credits: () => <span className="font-medium text-foreground tabular-nums">{credits(example.credits)}</span>,
              })}
            </li>
          ))}
          <li>{t("regeneration")}</li>
        </ul>
      </section>
    </main>
  );
}
