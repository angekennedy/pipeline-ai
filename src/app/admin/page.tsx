import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { COST, PERCENT, SHORT_DATE_TIME } from "@/i18n/format";
import { checkAlerts, loadEconomics, totals, type Alert } from "@/lib/admin/economics";
import { isPlatformAdmin } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/session";
import { PLANS, PLAN_KEYS, type PlanKey } from "@/lib/billing/plans";
import { serverEnv } from "@/lib/env/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("admin"), robots: { index: false, follow: false } };
}
export const instant = false; // vérification de l'administrateur avant tout rendu

const PERIODS = [7, 30, 90] as const;
const LIMIT = 200;
const DAY = 24 * 3600 * 1000;
const COLUMNS = ["date", "pipeline", "plan", "tier", "minutes", "status", "credits", "cost", "revenue", "margin", "cache", "failures"] as const;

// Coût et marge par pipeline, tous workspaces confondus (tâche 4.6). Le proxy répond déjà 404 à qui
// n'est pas dans ADMIN_EMAILS ; la page revérifie, puis lit en service role.
export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const user = await requireUser("/admin");
  if (!isPlatformAdmin(user.email)) notFound();
  const requested = Number((await searchParams).days);
  const days = PERIODS.find((period) => period === requested) ?? 30;

  const db = createAdminClient();
  const now = new Date();
  const [rows, alerts, t, labels, format] = await Promise.all([
    loadEconomics(db, new Date(now.getTime() - days * DAY), LIMIT),
    checkAlerts(db, now),
    getTranslations("Admin"),
    getTranslations("Labels"),
    getFormatter(),
  ]);
  const sum = totals(rows);
  const cost = (eur: number) => format.number(eur, COST);
  const percent = (ratio: number | null) => (ratio === null ? t("none") : format.number(ratio, PERCENT));
  const planName = (key: string) => (PLAN_KEYS.includes(key as PlanKey) ? PLANS[key as PlanKey].name : key);

  const alertText = (alert: Alert) => {
    switch (alert.kind) {
      case "costOutlier":
        return t("alert.costOutlier", {
          pipeline: alert.pipelineId.slice(0, 8),
          tier: alert.tier,
          cost: cost(alert.costPerMinuteUsd * serverEnv.USD_TO_EUR),
          median: cost(alert.medianPerMinuteUsd * serverEnv.USD_TO_EUR),
        });
      case "failureRate":
        return t("alert.failureRate", { rate: percent(alert.rate), failed: alert.failed, finished: alert.finished });
      case "staleReservations":
        return t("alert.staleReservations", { count: alert.count });
    }
  };

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("period", { days, count: rows.length, limit: LIMIT })}</p>
        <nav aria-label={t("periods")} className="mt-3 flex gap-2 text-sm">
          {PERIODS.map((period) => (
            <Link
              key={period}
              href={`/admin?days=${period}`}
              aria-current={period === days ? "page" : undefined}
              className="rounded-md border px-2 py-1 aria-[current=page]:bg-muted aria-[current=page]:font-medium"
            >
              {t("days", { days: period })}
            </Link>
          ))}
        </nav>
      </div>

      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          [t("totals.cost"), cost(sum.costEur)],
          [t("totals.revenue"), cost(sum.revenueEur)],
          [t("totals.margin"), `${cost(sum.marginEur)} · ${percent(sum.marginRate)}`],
          [t("totals.credits"), format.number(sum.credits)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">{t("estimate", { rate: format.number(serverEnv.USD_TO_EUR) })}</p>

      <section aria-labelledby="alerts" className="grid gap-2">
        <h2 id="alerts" className="text-lg font-semibold">
          {t("alerts")}
        </h2>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noAlerts")}</p>
        ) : (
          <ul className="grid gap-2">
            {alerts.map((alert, index) => (
              <li key={index} className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
                {alertText(alert)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pipelines" className="grid gap-2">
        <h2 id="pipelines" className="text-lg font-semibold">
          {t("table")}
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  {COLUMNS.map((column) => (
                    <th key={column} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                      {t(`col.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {rows.map((row) => (
                  <tr key={row.pipelineId} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">{format.dateTime(new Date(row.createdAt), SHORT_DATE_TIME)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.pipelineId.slice(0, 8)}</td>
                    <td className="px-3 py-2">{planName(row.planKey)}</td>
                    <td className="px-3 py-2">{row.tier}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{t("minutes", { minutes: row.minutes })}</td>
                    <td className="px-3 py-2">{labels(`pipelineStatus.${row.status}`)}</td>
                    <td className="px-3 py-2 text-right">{row.credits}</td>
                    <td className="px-3 py-2 text-right">{cost(row.costEur)}</td>
                    <td className="px-3 py-2 text-right">{cost(row.revenueEur)}</td>
                    <td className={`px-3 py-2 text-right whitespace-nowrap ${row.marginEur < 0 ? "text-destructive" : ""}`}>
                      {`${cost(row.marginEur)} · ${percent(row.marginRate)}`}
                    </td>
                    <td className="px-3 py-2 text-right">{percent(row.cacheHitRatio)}</td>
                    <td className="px-3 py-2 text-right">{`${row.failedGenerations}/${row.generations}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
