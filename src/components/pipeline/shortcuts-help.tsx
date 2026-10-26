"use client";

import { Keyboard } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { SHORTCUTS, shortcutFor, type ShortcutAction } from "@/lib/pipeline/shortcuts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Raccourcis de la page d'un pipeline : écoute du clavier et aide, avec leur désactivation (préférence
// du navigateur ; sans stockage disponible, ils restent actifs le temps de la page).

const STORAGE_KEY = "pipeline-ai:shortcuts";

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function useAssetShortcuts(onAction: (action: ShortcutAction) => void) {
  // Lu au premier rendu : côté serveur, sans stockage, la valeur par défaut (actifs). Le seul affichage
  // qui en dépend, la case de l'aide, n'est rendu qu'à l'ouverture : pas d'écart d'hydratation.
  const [enabled, setEnabled] = useState(readEnabled);

  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const action = shortcutFor({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, target: event.target as HTMLElement | null });
      // L'aide reste accessible même raccourcis désactivés, pour les réactiver.
      if (!action || (!enabled && action.type !== "help")) return;
      event.preventDefault();
      onAction(action);
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [enabled, onAction]);

  function toggle(next: boolean) {
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      // préférence non conservée : sans effet sur la page en cours
    }
  }
  return { enabled, toggle };
}

export function ShortcutsHelp({ open, onOpenChange, enabled, onToggle }: { open: boolean; onOpenChange: (open: boolean) => void; enabled: boolean; onToggle: (enabled: boolean) => void }) {
  const t = useTranslations("Shortcuts");
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(true)} aria-keyshortcuts="Shift+?">
        <Keyboard aria-hidden="true" />
        {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut} className="contents">
                <dt>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{t(`keys.${shortcut}`)}</kbd>
                </dt>
                <dd>{t(`label.${shortcut}`)}</dd>
              </div>
            ))}
          </dl>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} />
            {t("toggle")}
          </label>
        </DialogContent>
      </Dialog>
    </>
  );
}
