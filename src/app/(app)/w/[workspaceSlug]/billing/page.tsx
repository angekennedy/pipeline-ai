import type { Metadata } from "next";
import Link from "next/link";
import { BillingButton } from "@/components/billing/billing-button";
import { getFormatter, getTranslations } from "next-intl/server";
import { DATE, PRICE, SHORT_DATE_TIME } from "@/i18n/format";
import { CREDIT_PACKS, PLAN_KEYS, PLANS } from "@/lib/billing/plans";
import { ACCESS_STATUSES, billingEnabled } from "@/lib/billing/stripe";
import { LEGAL_PATHS } from "@/lib/legal";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { hasRole, requireMembership } from "@/lib/workspaces/access";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("billing") };
}
export const instant = false; // bloque avec le layout (vérification d'appartenance)

type LedgerKind = Database["public"]["Enums"]["ledger_kind"];

// Effet de chaque mouvement du registre sur le solde : réserver et libérer ne le changent pas, ils
// bloquent puis rendent une part du disponible. Libellés : Billing.ledger.
const SIGN: Record<LedgerKind, 1 | -1 | 0> = { grant: 1, purchase: 1, refund: 1, reserve: 0, capture: -1, release: 0, adjust: -1, expire: -1 };
const SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused"];

export default async function BillingPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/billing">) {
  const { workspaceSlug } = await params;
  const { workspace, role, credits } = await requireMembership(workspaceSlug);
  const { success, canceled } = await searchParams;
  const isAdmin = hasRole(role, "admin");
  const plan = PLANS[credits.planKey];
  const enabled = billingEnabled();
  const [t, all, format] = await Promise.all([getTranslations("Billing"), getTranslations(), getFormatter()]);
  const credit = (count: number) => all("Common.credits", { count });

  const db = await createClient();
  const [subscriptions, customer, ledger] = isAdmin
    ? await Promise.all([
        db
          .from("subscriptions")
          .select("status, plan_key, current_period_end, cancel_at_period_end")
          .eq("workspace_id", workspace.id)
          .order("updated_at", { ascending: false }),
        db.from("workspaces").select("stripe_customer_id").eq("id", workspace.id).single(),
        db
          .from("credit_ledger")
          .select("id, kind, amount, balance_after, pipeline_id, created_at")
          .eq("workspace_id", workspace.id)
          .order("id", { ascending: false })
          .limit(20),
      ])
    : [null, null, null];
  for (const result of [subscriptions, customer, ledger]) {
    if (result?.error) throw new Error(`Facturation de ${workspace.slug} : ${result.error.message}`);
  }
  const subscription = subscriptions?.data?.find((s) => ACCESS_STATUSES.includes(s.status)) ?? subscriptions?.data?.[0];
  const subscribed = Boolean(subscription && ACCESS_STATUSES.includes(subscription.status));
  const hasCustomer = Boolean(customer?.data?.stripe_customer_id);

  return (
    <main className="mx-auto grid w-full max-w-4xl gap-10 px-4 py-10">
      <div>
        <Link href={`/w/${workspace.slug}/dashboard`} className="text-sm text-muted-foreground hover:text-foreground">
          {t("allPipelines")}
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{workspace.name}</p>
      </div>

      {success === "1" && (
        <p role="status" className="rounded-xl border border-emerald-600/40 bg-emerald-600/5 p-4 text-sm">
          {t("success")}
        </p>
      )}
      {canceled === "1" && (
        <p role="status" className="rounded-xl border p-4 text-sm">
          {t("canceled")}
        </p>
      )}
      {!enabled && (
        <p role="status" className="rounded-xl border p-4 text-sm">
          {t("disabled")}
        </p>
      )}

      <section aria-labelledby="current" className="grid gap-2 rounded-xl border p-5">
        <h2 id="current" className="text-lg font-semibold">
          {t("plan", { plan: plan.name })}
        </h2>
        <p className="text-sm">
          {t("available", { credits: credit(credits.available) })}
          {credits.reserved > 0 && (
            <span className="text-muted-foreground"> {t("reserved", { credits: credit(credits.reserved) })}</span>
          )}
        </p>
        {subscription && (
          <p className="text-sm text-muted-foreground">
            {t("subscription", {
              status: SUBSCRIPTION_STATUSES.includes(subscription.status) ? t(`status.${subscription.status as "active"}`) : subscription.status,
            })}
            {subscription.current_period_end &&
              ` · ${t(subscription.cancel_at_period_end ? "ends" : "renews", { date: format.dateTime(new Date(subscription.current_period_end), DATE) })}`}
          </p>
        )}
        {subscription?.status === "past_due" && (
          <p role="alert" className="text-sm text-destructive">
            {t("pastDue")}
          </p>
        )}
        {isAdmin && enabled && hasCustomer && (
          <div className="mt-2 w-fit">
            <BillingButton kind="portal" workspaceSlug={workspace.slug} label={t("portal")} variant="outline" />
          </div>
        )}
        {!isAdmin && <p className="text-sm text-muted-foreground">{t("adminOnly")}</p>}
      </section>

      {isAdmin && enabled && (
        <>
          <section aria-labelledby="plans" className="grid gap-4">
            <h2 id="plans" className="text-lg font-semibold">
              {subscribed ? t("changePlan") : t("upgrade")}
            </h2>
            {subscribed && (
              <p className="text-sm text-muted-foreground">{t("changeViaPortal")}</p>
            )}
            <ul className="grid gap-4 sm:grid-cols-3">
              {PLAN_KEYS.filter((key) => PLANS[key].lookupKey).map((key) => {
                const offer = PLANS[key];
                return (
                  <li key={key} className="flex flex-col gap-3 rounded-xl border p-5">
                    <h3 className="font-semibold">{offer.name}</h3>
                    <p className="text-2xl font-semibold tabular-nums">
                      {format.number(offer.priceEurCents / 100, PRICE)}
                      <span className="text-sm font-normal text-muted-foreground">{t("perMonth")}</span>
                    </p>
                    <p className="flex-1 text-sm">{t("monthlyCredits", { credits: credit(offer.credits) })}</p>
                    {key === credits.planKey && subscribed ? (
                      <p className="text-sm font-medium">{t("yourPlan")}</p>
                    ) : (
                      !subscribed && (
                        <BillingButton
                          kind="checkout"
                          workspaceSlug={workspace.slug}
                          lookupKey={offer.lookupKey!}
                          label={t("choose")}
                          accessibleLabel={t("choosePlan", { plan: offer.name })}
                        />
                      )
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">{t("taxes")}</p>
            <p className="text-xs text-muted-foreground">{t("carryOver")}</p>
          </section>

          <section aria-labelledby="packs" className="grid gap-4">
            <h2 id="packs" className="text-lg font-semibold">
              {t("packs")}
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {CREDIT_PACKS.map((pack) => (
                <li key={pack.credits} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                  <span>
                    <span className="font-medium">{credit(pack.credits)}</span>{" "}
                    <span className="text-muted-foreground tabular-nums">{format.number(pack.priceEurCents / 100, PRICE)}</span>
                  </span>
                  <BillingButton
                    kind="checkout"
                    workspaceSlug={workspace.slug}
                    lookupKey={pack.lookupKey}
                    label={t("buy")}
                    accessibleLabel={t("buyPack", { credits: credit(pack.credits) })}
                    variant="outline"
                  />
                </li>
              ))}
            </ul>
          </section>

          <p className="text-xs text-muted-foreground">
            {t.rich("consent", {
              terms: (chunks) => (
                <Link href={LEGAL_PATHS.terms} className="underline underline-offset-4">
                  {chunks}
                </Link>
              ),
              privacy: (chunks) => (
                <Link href={LEGAL_PATHS.privacy} className="underline underline-offset-4">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </>
      )}

      {ledger && (
        <section aria-labelledby="history" className="grid gap-3">
          <h2 id="history" className="text-lg font-semibold">
            {t("history")}
          </h2>
          {ledger.data?.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 font-normal">{t("col.date")}</th>
                  <th className="py-2 font-normal">{t("col.movement")}</th>
                  <th className="py-2 text-right font-normal">{t("col.credits")}</th>
                  <th className="hidden py-2 text-right font-normal sm:table-cell">{t("col.balance")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.map((entry) => {
                  const sign = SIGN[entry.kind];
                  const label = t(`ledger.${entry.kind}`);
                  return (
                    <tr key={entry.id} className="border-t">
                      <td className="py-2 whitespace-nowrap">{format.dateTime(new Date(entry.created_at), SHORT_DATE_TIME)}</td>
                      <td className="py-2">
                        {entry.pipeline_id ? (
                          <Link href={`/w/${workspace.slug}/pipelines/${entry.pipeline_id}`} className="hover:underline">
                            {label}
                          </Link>
                        ) : (
                          label
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums">{sign === 0 ? `(${entry.amount})` : `${sign > 0 ? "+" : "−"}${entry.amount}`}</td>
                      <td className="hidden py-2 text-right tabular-nums sm:table-cell">{entry.balance_after}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noMovement")}</p>
          )}
        </section>
      )}
    </main>
  );
}
