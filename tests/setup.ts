import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach } from "vitest";
import { server } from "./mocks/server";

// Démarré dès le chargement, avant l'import des fichiers de test : un client créé au niveau
// module (comme le SDK Anthropic, qui capture `fetch` à la construction) est alors déjà intercepté.
// Toute requête réseau non mockée fait échouer le test : aucun appel réel à une API.
server.listen({ onUnhandledFrame: "error" });

afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
