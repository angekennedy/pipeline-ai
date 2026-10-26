import { createTranslator } from "next-intl";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import type { Translator } from "@/i18n/types";

// Traducteurs des modules hors React (exports, messages de refus), avec les vrais messages.
export const tFr = createTranslator({ locale: "fr", messages: fr }) as unknown as Translator;
export const tEn = createTranslator({ locale: "en", messages: en }) as unknown as Translator;
export const restrictionFr = createTranslator({ locale: "fr", messages: fr, namespace: "Restriction" }) as unknown as Translator<"Restriction">;
