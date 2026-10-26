import type messages from "../../messages/fr.json";
import type { Locale } from "./locales";

// Clés de traduction typées sur le français (langue de référence) : une clé absente ou mal écrite fait
// échouer le typecheck. L'anglais a les mêmes clés (tests/unit/i18n/coverage.test.ts).
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
