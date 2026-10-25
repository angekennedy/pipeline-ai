"use client";

import { CircleAlert, CircleCheck, CircleDashed, CircleMinus, LoaderCircle } from "lucide-react";
import { ASSET_TYPES, type AssetType, type Scene } from "@/lib/ai/schemas";
import { ASSET_LABELS } from "@/lib/pipeline/labels";
import type { AssetViewStatus, PipelineView } from "@/lib/pipeline/view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScriptPanel, SeoPanel, ThumbnailsPanel, TitlesPanel, VoiceoverPanel } from "./asset-panels";
import { SceneStream } from "./scene-stream";

export const ASSET_STATUS_LABELS: Record<AssetViewStatus, string> = {
  pending: "en attente",
  running: "en cours",
  ready: "prêt",
  failed: "échec",
  skipped: "non généré",
};

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

const WAITING_FOR: Record<AssetType, string> = {
  script: "Le script démarre dès que le pipeline est pris en charge.",
  titles: "Les titres démarrent dès que le script est prêt.",
  seo: "Le SEO démarre dès que le script est prêt.",
  voiceover: "La voix off démarre dès que le script est prêt.",
  thumbnails: "Les miniatures démarrent dès que les titres sont prêts.",
};

const SKIPPED_BECAUSE: Record<AssetType, string> = {
  script: "Le script n'a pas été généré.",
  titles: "Non généré : le script n'a pas abouti.",
  seo: "Non généré : le script n'a pas abouti.",
  voiceover: "Non généré : le script n'a pas abouti.",
  thumbnails: "Non généré : le script ou les titres n'ont pas abouti.",
};

function Generating({ type }: { type: AssetType }) {
  return (
    <div role="status" className="grid gap-2">
      <span className="text-sm text-muted-foreground">Génération : {ASSET_LABELS[type].toLowerCase()}…</span>
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

function AssetContent({ view, type, scenes }: { view: PipelineView; type: AssetType; scenes: Scene[] }) {
  const asset = view.assets[type];
  switch (asset.status) {
    case "pending":
      return <p className="text-sm text-muted-foreground">{WAITING_FOR[type]}</p>;
    case "skipped":
      return <p className="text-sm text-muted-foreground">{SKIPPED_BECAUSE[type]}</p>;
    case "failed":
      return (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">Échec de la génération</p>
          <p className="mt-1 text-sm">{asset.error?.message ?? "Une erreur inattendue est survenue."}</p>
          {asset.error && <p className="mt-1 font-mono text-xs text-muted-foreground">{asset.error.code}</p>}
          {/* Régénération par asset : tâche 1.10. */}
          <Button type="button" variant="outline" size="sm" className="mt-3" disabled>
            Régénérer (bientôt disponible)
          </Button>
        </div>
      );
    case "running":
      // Le script s'affiche scène par scène pendant le stream.
      return type === "script" && scenes.length > 0 ? <SceneStream scenes={scenes} streaming /> : <Generating type={type} />;
    case "ready":
      return <ReadyAsset view={view} type={type} />;
  }
}

function ReadyAsset({ view, type }: { view: PipelineView; type: AssetType }) {
  const { assets } = view;
  switch (type) {
    case "script":
      return assets.script.content && <ScriptPanel script={assets.script.content} />;
    case "titles":
      return assets.titles.content && <TitlesPanel titles={assets.titles.content} />;
    case "seo":
      return assets.seo.content && <SeoPanel seo={assets.seo.content} />;
    case "voiceover":
      return assets.voiceover.content && <VoiceoverPanel voiceover={assets.voiceover.content} />;
    case "thumbnails":
      return assets.thumbnails.content && <ThumbnailsPanel thumbnails={assets.thumbnails.content} titles={assets.titles.content} />;
  }
}

export function AssetTabs({ view, scenes }: { view: PipelineView; scenes: Scene[] }) {
  return (
    <Tabs defaultValue="script" className="min-w-0">
      <TabsList className="max-w-full justify-start overflow-x-auto">
        {ASSET_TYPES.map((type) => (
          <TabsTrigger key={type} value={type}>
            <AssetStatusIcon status={view.assets[type].status} />
            {ASSET_LABELS[type]}
            <span className="sr-only">({ASSET_STATUS_LABELS[view.assets[type].status]})</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {ASSET_TYPES.map((type) => (
        <TabsContent key={type} value={type} className="pt-4">
          <AssetContent view={view} type={type} scenes={scenes} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
