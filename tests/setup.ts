import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, vi } from "vitest";
import messages from "../messages/fr.json";
import { server } from "./mocks/server";

// Traductions : les composants et les pages sont rendus avec les vrais messages français (langue par
// défaut), sans fournisseur next-intl ni configuration de requête.
vi.mock("next-intl", async (original) => {
  const actual = await original<typeof import("next-intl")>();
  const translator = (namespace?: string) => actual.createTranslator({ locale: "fr", messages, namespace: namespace as never });
  return {
    ...actual,
    useTranslations: translator,
    useFormatter: () => actual.createFormatter({ locale: "fr", timeZone: "Europe/Paris" }),
    useLocale: () => "fr",
    NextIntlClientProvider: ({ children }: { children: unknown }) => children,
  };
});
vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await vi.importActual<typeof import("next-intl")>("next-intl");
  const translator = (options?: string | { namespace?: string }) =>
    createTranslator({ locale: "fr", messages, namespace: (typeof options === "string" ? options : options?.namespace) as never });
  return {
    getTranslations: async (options?: string | { namespace?: string }) => translator(options),
    getFormatter: async () => createFormatter({ locale: "fr", timeZone: "Europe/Paris" }),
    getLocale: async () => "fr",
  };
});

// Démarré dès le chargement, avant l'import des fichiers de test : un client créé au niveau
// module (comme le SDK Anthropic, qui capture `fetch` à la construction) est alors déjà intercepté.
// Toute requête réseau non mockée fait échouer le test : aucun appel réel à une API.
server.listen({ onUnhandledFrame: "error" });

afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
