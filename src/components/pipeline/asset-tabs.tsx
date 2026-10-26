"use client";

import { useTranslations } from "next-intl";
import { CircleAlert, CircleCheck, CircleDashed, CircleMinus, LoaderCircle, Pencil } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ASSET_TYPES, type AssetType, type Scene, type Script } from "@/lib/ai/schemas";
import { assetCredits } from "@/lib/billing/costs";
import type { AssetViewStatus, PipelineView } from "@/lib/pipeline/view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StaleNotice, VersionHistory } from "./asset-history";
import { ScriptPanel, SeoPanel, ThumbnailsPanel, TitlesPanel, VoiceoverPanel } from "./asset-panels";
import { RegenerateButton, usePipelineActions } from "./pipeline-actions";
import { ScriptEditor } from "./script-editor";
import { ShortcutsHelp, useAssetShortcuts } from "./shortcuts-help";
import type { ShortcutAction } from "@/lib/pipeline/shortcuts";

// Raccourci « e » : l'onglet Script ouvre son éditeur.
const EDIT_SCRIPT_EVENT = "pipeline:edit-script";
import { SceneStream } from "./scene-stream";


const STATUS_ICONS = {
  pending: CircleDashed,
  running: LoaderCircle,
  ready: CircleCheck,
  failed: CircleAlert,
  skipped: CircleMinus,
} as const;

export function AssetStatusIcon({ status }: { status: AssetViewStatus }) {
  const Icon = STATUS_ICONS[status];
  return (
    <Icon
      aria-hidden="true"
      className={
        status === "running"
          ? "animate-spin text-muted-foreground"
          : status === "ready"
            ? "text-emerald-600"
            : status === "failed"
              ? "text-destructive"
              : "text-muted-foreground"
      }
    />
  );
}



function Generating({ type }: { type: AssetType }) {
  const t = useTranslations("AssetTabs");
  const labels = useTranslations("Labels");
  return (
    <div role="status" className="grid gap-2">
      <span className="text-sm text-muted-foreground">{t("generating", { asset: labels(`assets.${type}`).toLowerCase() })}</span>
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

function AssetContent({ view, type, scenes }: { view: PipelineView; type: AssetType; scenes: Scene[] }) {
  const t = useTranslations("AssetTabs");
  const failures = useTranslations("Failures");
  const asset = view.assets[type];
  const regenCredits = assetCredits(view.brief, view.tier)[type]; // une régénération coûte comme la génération
  switch (asset.status) {
    case "pending":
      return <p className="text-sm text-muted-foreground">{t(`waiting.${type}`)}</p>;
    case "skipped":
      return <p className="text-sm text-muted-foreground">{t(`skipped.${type}`)}</p>;
    case "failed":
      return (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">{t("failedTitle")}</p>
          <p className="mt-1 text-sm">{asset.error && failures.has(asset.error.code as "generic") ? failures(asset.error.code as "generic") : failures("generic")}</p>
          {asset.error && <p className="mt-1 font-mono text-xs text-muted-foreground">{asset.error.code}</p>}
          <div className="mt-3">
            <RegenerateButton types={[type]} credits={regenCredits} />
          </div>
        </div>
      );
    case "running":
      // Le script s'affiche scène par scène pendant le stream.
      return type === "script" && scenes.length > 0 ? <SceneStream scenes={scenes} streaming /> : <Generating type={type} />;
    case "ready":
      return (
        <>
          {asset.stale && <StaleNotice type={type} credits={regenCredits} />}
          <VersionHistory type={type} versions={asset.versions} />
          <ReadyAsset view={view} type={type} />
        </>
      );
  }
}

function ReadyAsset({ view, type }: { view: PipelineView; type: AssetType }) {
  const { assets } = view;
  switch (type) {
    case "script":
      return assets.script.content && <ScriptAsset script={assets.script.content} />;
    case "titles":
      return assets.titles.content && <TitlesPanel titles={assets.titles.content} />;
    case "seo":
      return assets.seo.content && <SeoPanel seo={assets.seo.content} />;
    case "voiceover":
      return assets.voiceover.content && <VoiceoverPanel voiceover={assets.voiceover.content} />;
    case "thumbnails":
      return assets.thumbnails.content && <ThumbnailsPanel thumbnails={assets.thumbnails.content} titles={assets.titles.content} durationMinutes={view.brief.durationMinutes} />;
  }
}

// Script prêt : lecture, ou édition dans la page pour un éditeur d'un pipeline réel.
function ScriptAsset({ script }: { script: Script }) {
  const t = useTranslations("AssetTabs");
  const actions = usePipelineActions();
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!actions) return;
    const open = () => setEditing(true);
    window.addEventListener(EDIT_SCRIPT_EVENT, open);
    return () => window.removeEventListener(EDIT_SCRIPT_EVENT, open);
  }, [actions]);
  if (actions && editing) return <ScriptEditor script={script} actions={actions} onDone={() => setEditing(false)} />;
  return (
    <>
      {actions && (
        <Button type="button" variant="outline" size="sm" className="mb-4" onClick={() => setEditing(true)}>
          <Pencil aria-hidden="true" />
          {t("editScript")}
        </Button>
      )}
      <ScriptPanel script={script} />
    </>
  );
}

export function AssetTabs({ view, scenes }: { view: PipelineView; scenes: Scene[] }) {
  const t = useTranslations("AssetTabs");
  const labels = useTranslations("Labels");
  const [tab, setTab] = useState<AssetType>("script");
  const [helpOpen, setHelpOpen] = useState(false);
  const onShortcut = useCallback((action: ShortcutAction) => {
    if (action.type === "tab") setTab(action.asset);
    else if (action.type === "help") setHelpOpen(true);
    else if (action.type === "copy") {
      document.querySelector<HTMLButtonElement>('[role="tabpanel"]:not([hidden]) [data-shortcut-copy]')?.click();
    } else {
      setTab("script");
      window.dispatchEvent(new Event(EDIT_SCRIPT_EVENT));
    }
  }, []);
  const shortcuts = useAssetShortcuts(onShortcut);

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as AssetType)} className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          {ASSET_TYPES.map((type) => (
            <TabsTrigger key={type} value={type}>
              <AssetStatusIcon status={view.assets[type].status} />
              {labels(`assets.${type}`)}
              {view.assets[type].stale && <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500" />}
              <span className="sr-only">
                ({labels(`assetStatus.${view.assets[type].status}`)}
                {view.assets[type].stale ? `, ${t("stale")}` : ""})
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} enabled={shortcuts.enabled} onToggle={shortcuts.toggle} />
      </div>
      {ASSET_TYPES.map((type) => (
        <TabsContent key={type} value={type} className="pt-4">
          <AssetContent view={view} type={type} scenes={scenes} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
