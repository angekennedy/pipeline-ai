import type { _Translator } from "next-intl";
import type messages from "../../messages/fr.json";

// Traducteur, pour les modules qui produisent du texte hors React (exports) : celui de `useTranslations`
// dans un composant, ou de `getTranslations` dans une route. Sans espace de noms, toutes les clés sont
// accessibles (`Export.…`, `Labels.…`).
export type Translator<Namespace extends keyof typeof messages = never> = _Translator<typeof messages, Namespace>;
