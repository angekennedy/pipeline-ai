"use client";

import Link from "next/link";
import { CREDIT_PACKS, formatCredits, formatEuros } from "@/lib/billing/plans";
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
  const missing = required - available;
  // Le plus petit pack qui couvre le manque, sinon le plus grand.
  const pack = CREDIT_PACKS.find((p) => p.credits >= missing) ?? CREDIT_PACKS[CREDIT_PACKS.length - 1]!;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crédits insuffisants</DialogTitle>
          <DialogDescription>
            Ce pipeline coûte {formatCredits(required)} et vous en avez {available} disponibles : il en manque {missing}. Rien n&apos;a été lancé
            ni débité.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Réduisez la durée ou passez en Standard, ou rechargez votre compte : un pack de {formatCredits(pack.credits)} coûte{" "}
          {formatEuros(pack.priceEurCents)}, sans expiration.
        </p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Modifier le brief</DialogClose>
          <Link href="/pricing" className={buttonVariants()}>
            Voir les tarifs
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
