"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { openPortal, startCheckout, type BillingState } from "@/app/(app)/w/[workspaceSlug]/billing/actions";
import { Button } from "@/components/ui/button";

// Bouton de la page de facturation : vers Stripe Checkout (une offre) ou le Customer Portal.
export function BillingButton({
  kind,
  workspaceSlug,
  lookupKey,
  label,
  accessibleLabel,
  variant = "default",
}: {
  kind: "checkout" | "portal";
  workspaceSlug: string;
  lookupKey?: string;
  label: string;
  accessibleLabel?: string;
  variant?: "default" | "outline";
}) {
  const t = useTranslations("Billing");
  const [state, action, pending] = useActionState<BillingState, FormData>(kind === "checkout" ? startCheckout : openPortal, {});
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      {lookupKey && <input type="hidden" name="lookupKey" value={lookupKey} />}
      <Button type="submit" variant={variant} disabled={pending} aria-label={accessibleLabel}>
        {pending ? t("redirecting") : label}
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${state.error}`)}
        </p>
      )}
    </form>
  );
}
