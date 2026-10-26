import type { Metadata } from "next";
import Link from "next/link";
import { BillingButton } from "@/components/billing/billing-button";
import { CREDIT_PACKS, PLAN_KEYS, PLANS, formatCredits, formatEuros } from "@/lib/billing/plans";
import { ACCESS_STATUSES, billingEnabled } from "@/lib/billing/stripe";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { hasRole, requireMembership } from "@/lib/workspaces/access";

export const metadata: Metadata = { title: "Facturation · Pipeline AI" };
export const instant = false; // bloque avec le layout (vérification d'appartenance)

type LedgerKind = Database["public"]["Enums"]["ledger_kind"];

// Mouvements du registre de crédits : libellé et effet sur le solde (réserver et libérer ne le
// changent pas, ils bloquent puis rendent une part du disponible).
const LEDGER: Record<LedgerKind, { label: string; sign: 1 | -1 | 0 }> = {
  grant: { label: "Crédits du plan", sign: 1 },
  purchase: { label: "Achat de pack", sign: 1 },
  refund: { label: "Remboursement", sign: 1 },
  reserve: { label: "Réservation d'un pipeline", sign: 0 },
  capture: { label: "Asset généré", sign: -1 },
  release: { label: "Réservation libérée", sign: 0 },
  adjust: { label: "Ajustement", sign: -1 },
  expire: { label: "Report plafonné", sign: -1 },
};

const SUBSCRIPTION_STATUS: Record<string, string> = {
  active: "actif",
  trialing: "en essai",
  past_due: "paiement en retard",
  unpaid: "impayé",
  canceled: "résilié",
  incomplete: "paiement en attente",
  incomplete_expired: "expiré",
  paused: "en pause",
};

const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" });
const DATE_TIME = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

export default async function BillingPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/billing">) {
  const { workspaceSlug } = await params;
  const { workspace, role, credits } = await requireMembership(workspaceSlug);
  const { success, canceled } = await searchParams;
  const isAdmin = hasRole(role, "admin");
  const plan = PLANS[credits.planKey];
  const enabled = billingEnabled();

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
          ← Tous les pipelines
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Facturation</h1>
        <p className="mt-1 text-muted-foreground">{workspace.name}</p>
      </div>

      {success === "1" && (
        <p role="status" className="rounded-xl border border-emerald-600/40 bg-emerald-600/5 p-4 text-sm">
          Paiement reçu, merci. Les crédits arrivent sur votre solde dans quelques secondes : rechargez la page s&apos;ils n&apos;apparaissent pas.
        </p>
      )}
      {canceled === "1" && (
        <p role="status" className="rounded-xl border p-4 text-sm">
          Paiement annulé : rien n&apos;a été débité.
        </p>
      )}
      {!enabled && (
        <p role="status" className="rounded-xl border p-4 text-sm">
          Le paiement en ligne n&apos;est pas configuré sur cet environnement.
        </p>
      )}

      <section aria-labelledby="current" className="grid gap-2 rounded-xl border p-5">
        <h2 id="current" className="text-lg font-semibold">
          Plan {plan.name}
        </h2>
        <p className="text-sm">
          {formatCredits(credits.available)} disponibles
          {credits.reserved > 0 && (
            <span className="text-muted-foreground"> ({formatCredits(credits.reserved)} réservés par des pipelines en cours)</span>
          )}
        </p>
        {subscription && (
          <p className="text-sm text-muted-foreground">
            Abonnement {SUBSCRIPTION_STATUS[subscription.status] ?? subscription.status}
            {subscription.current_period_end &&
              ` · ${subscription.cancel_at_period_end ? "se termine le" : "renouvelé le"} ${DATE.format(new Date(subscription.current_period_end))}`}
          </p>
        )}
        {subscription?.status === "past_due" && (
          <p role="alert" className="text-sm text-destructive">
            Le dernier paiement a échoué : la création de pipelines est suspendue. Mettez à jour votre moyen de paiement.
          </p>
        )}
        {isAdmin && enabled && hasCustomer && (
          <div className="mt-2 w-fit">
            <BillingButton kind="portal" workspaceSlug={workspace.slug} label="Gérer l'abonnement et les factures" variant="outline" />
          </div>
        )}
        {!isAdmin && <p className="text-sm text-muted-foreground">Seuls les administrateurs du workspace gèrent la facturation.</p>}
      </section>

      {isAdmin && enabled && (
        <>
          <section aria-labelledby="plans" className="grid gap-4">
            <h2 id="plans" className="text-lg font-semibold">
              {subscribed ? "Changer de plan" : "Passer à un plan payant"}
            </h2>
            {subscribed && (
              <p className="text-sm text-muted-foreground">Le changement de plan se fait dans le portail : la différence est calculée au prorata.</p>
            )}
            <ul className="grid gap-4 sm:grid-cols-3">
              {PLAN_KEYS.filter((key) => PLANS[key].lookupKey).map((key) => {
                const offer = PLANS[key];
                return (
                  <li key={key} className="flex flex-col gap-3 rounded-xl border p-5">
                    <h3 className="font-semibold">{offer.name}</h3>
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatEuros(offer.priceEurCents)}
                      <span className="text-sm font-normal text-muted-foreground"> / mois</span>
                    </p>
                    <p className="flex-1 text-sm">{formatCredits(offer.credits)} par mois</p>
                    {key === credits.planKey && subscribed ? (
                      <p className="text-sm font-medium">Votre plan</p>
                    ) : (
                      !subscribed && (
                        <BillingButton
                          kind="checkout"
                          workspaceSlug={workspace.slug}
                          lookupKey={offer.lookupKey!}
                          label="Choisir"
                          accessibleLabel={`Choisir le plan ${offer.name}`}
                        />
                      )
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">Les crédits non utilisés sont reportés, dans la limite d&apos;un mois d&apos;allocation.</p>
          </section>

          <section aria-labelledby="packs" className="grid gap-4">
            <h2 id="packs" className="text-lg font-semibold">
              Packs de crédits
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {CREDIT_PACKS.map((pack) => (
                <li key={pack.credits} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                  <span>
                    <span className="font-medium">{formatCredits(pack.credits)}</span>{" "}
                    <span className="text-muted-foreground tabular-nums">{formatEuros(pack.priceEurCents)}</span>
                  </span>
                  <BillingButton
                    kind="checkout"
                    workspaceSlug={workspace.slug}
                    lookupKey={pack.lookupKey}
                    label="Acheter"
                    accessibleLabel={`Acheter ${formatCredits(pack.credits)}`}
                    variant="outline"
                  />
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {ledger && (
        <section aria-labelledby="history" className="grid gap-3">
          <h2 id="history" className="text-lg font-semibold">
            Historique des crédits
          </h2>
          {ledger.data?.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 font-normal">Date</th>
                  <th className="py-2 font-normal">Mouvement</th>
                  <th className="py-2 text-right font-normal">Crédits</th>
                  <th className="hidden py-2 text-right font-normal sm:table-cell">Solde</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.map((entry) => {
                  const { label, sign } = LEDGER[entry.kind];
                  return (
                    <tr key={entry.id} className="border-t">
                      <td className="py-2 whitespace-nowrap">{DATE_TIME.format(new Date(entry.created_at))}</td>
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
            <p className="text-sm text-muted-foreground">Aucun mouvement pour l&apos;instant.</p>
          )}
        </section>
      )}
    </main>
  );
}
