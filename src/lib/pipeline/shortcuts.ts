import { ASSET_TYPES, type AssetType } from "@/lib/ai/schemas";

// Raccourcis clavier de la page d'un pipeline (tâche 4.3). Une seule touche, sans modificateur : ils
// sont ignorés pendant la saisie (champ, zone de texte, liste, contenu éditable) et désactivables
// (WCAG 2.1.4, raccourcis à un caractère).

export type ShortcutAction = { type: "tab"; asset: AssetType } | { type: "copy" } | { type: "edit" } | { type: "help" };

export const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: "1 à 5", label: "Ouvrir l'onglet Script, Titres, SEO, Voix off ou Miniatures" },
  { keys: "c", label: "Copier le contenu principal de l'onglet" },
  { keys: "e", label: "Modifier le script" },
  { keys: "?", label: "Afficher les raccourcis" },
];

type KeyInput = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
};

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function shortcutFor(event: KeyInput): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const target = event.target;
  if (target && (TYPING.has(target.tagName?.toUpperCase() ?? "") || target.isContentEditable)) return null;

  const index = Number(event.key) - 1;
  if (/^[1-5]$/.test(event.key)) return { type: "tab", asset: ASSET_TYPES[index]! };
  switch (event.key.toLowerCase()) {
    case "c":
      return { type: "copy" };
    case "e":
      return { type: "edit" };
    case "?":
      return { type: "help" };
    default:
      return null;
  }
}
