"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { PRICE } from "@/i18n/format";
import { CREDIT_PACKS } from "@/lib/billing/plans";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Ouvert quand la réservation échoue (InsufficientCreditsError) : rien n'a été créé ni débité.
export function InsufficientCreditsDialog({
  open,
  onOpenChange,
  required,
  available,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  required: number;
  available: number;
}) {
  const t = useTranslations("InsufficientCredits");
  const common = useTranslations("Common");
  const format = useFormatter();
  const missing = required - available;
  // Le plus petit pack qui couvre le manque, sinon le plus grand.
  const pack = CREDIT_PACKS.find((p) => p.credits >= missing) ?? CREDIT_PACKS[CREDIT_PACKS.length - 1]!;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { required: common("credits", { count: required }), available, missing })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("hint", { credits: common("credits", { count: pack.credits }), price: format.number(pack.priceEurCents / 100, PRICE) })}
        </p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t("edit")}</DialogClose>
          <Link href="/billing" className={buttonVariants()}>
            {t("buy")}
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
