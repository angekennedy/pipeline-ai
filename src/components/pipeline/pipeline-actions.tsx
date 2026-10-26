"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, useActionState, useContext, useEffect, useState } from "react";
import { regenerateAssets, restoreAssetVersion, type RegenerateState } from "@/app/(app)/w/[workspaceSlug]/pipelines/[pipelineId]/actions";
import type { AssetType } from "@/lib/ai/schemas";
import { restrictionMessage } from "@/lib/billing/entitlements";
import { InsufficientCreditsDialog } from "@/components/billing/insufficient-credits-dialog";
import { Button } from "@/components/ui/button";

// Actions sur un pipeline réel (tâche 4.2) : fournies par la page d'un pipeline à un éditeur. Absentes
// (démonstrations, lecteur), les boutons restent affichés mais désactivés.
export type PipelineActionsValue = { workspaceSlug: string; pipelineId: string };
const PipelineActionsContext = createContext<PipelineActionsValue | null>(null);
export const PipelineActionsProvider = PipelineActionsContext.Provider;
export const usePipelineActions = () => useContext(PipelineActionsContext);

function Hidden({ actions }: { actions: PipelineActionsValue }) {
  return (
    <>
      <input type="hidden" name="workspaceSlug" value={actions.workspaceSlug} />
      <input type="hidden" name="pipelineId" value={actions.pipelineId} />
    </>
  );
}

// Une clé par affichage : un double clic ne réserve et ne lance qu'une fois ; une nouvelle clé après
// chaque demande acceptée.
const nonce = () => crypto.randomUUID();

export function RegenerateButton({
  types,
  credits,
  label,
  variant = "outline",
}: {
  types: AssetType[];
  credits: number;
  label?: string;
  variant?: "default" | "outline";
}) {
  const t = useTranslations("PipelineActions");
  const common = useTranslations("Common");
  const restriction = useTranslations("Restriction");
  const actions = usePipelineActions();
  const [state, action, pending] = useActionState<RegenerateState, FormData>(regenerateAssets, {});
  const [key, setKey] = useState(nonce);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [answered, setAnswered] = useState(state);
  if (answered !== state) {
    setAnswered(state);
    if (state.requested) setKey(nonce());
    setDialogOpen(Boolean(state.insufficient));
  }

  const text = t("withCost", { label: pending ? t("launching") : (label ?? t("regenerate")), credits: common("credits", { count: credits }) });
  if (!actions) {
    return (
      <Button type="button" variant={variant} size="sm" disabled title={t("unavailable")}>
        {text}
      </Button>
    );
  }
  return (
    <form action={action} className="inline-grid gap-2">
      <Hidden actions={actions} />
      <input type="hidden" name="nonce" value={key} />
      {types.map((type) => (
        <input key={type} type="hidden" name="assetType" value={type} />
      ))}
      <Button type="submit" variant={variant} size="sm" disabled={pending}>
        {text}
      </Button>
      {state.requested && (
        // La génération démarre dans quelques secondes : la page est relue jusqu'à ce qu'elle apparaisse.
        <p role="status" className="text-sm text-muted-foreground">
          {t("launched")}
          <AutoRefresh active />
        </p>
      )}
      {(state.restriction || state.busy) && (
        <p role="alert" className="text-sm text-destructive">
          {state.restriction ? restrictionMessage(state.restriction, restriction) : t("busy")}
        </p>
      )}
      {state.insufficient && <InsufficientCreditsDialog open={dialogOpen} onOpenChange={setDialogOpen} {...state.insufficient} />}
    </form>
  );
}

export function RestoreButton({ type, versionId }: { type: AssetType; versionId: string }) {
  const t = useTranslations("PipelineActions");
  const actions = usePipelineActions();
  if (!actions) {
    return (
      <Button type="button" variant="ghost" size="xs" disabled title={t("unavailable")}>
        {t("restore")}
      </Button>
    );
  }
  return (
    <form action={restoreAssetVersion} className="inline">
      <Hidden actions={actions} />
      <input type="hidden" name="assetType" value={type} />
      <input type="hidden" name="versionId" value={versionId} />
      <Button type="submit" variant="ghost" size="xs">
        {t("restore")}
      </Button>
    </form>
  );
}

// Pipeline terminé dont un asset se régénère : la page est relue jusqu'à la fin de la régénération.
export function AutoRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);
  return null;
}
