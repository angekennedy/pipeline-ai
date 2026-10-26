// URL publique du site (tâche 5.1) : base des métadonnées (Open Graph, canonique), du sitemap et de
// robots.txt. `NEXT_PUBLIC_SITE_URL` en priorité (domaine personnalisé), sinon le domaine de
// production de Vercel (variable système), sinon le serveur local.
export function siteUrl(env: Record<string, string | undefined> = process.env): URL {
  if (env.NEXT_PUBLIC_SITE_URL) return new URL(env.NEXT_PUBLIC_SITE_URL);
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return new URL(`https://${env.VERCEL_PROJECT_PRODUCTION_URL}`);
  return new URL("http://localhost:3000");
}

// Pages publiques indexables. Les pipelines d'exemple réels y figurent ; les autres démonstrations
// (états d'erreur, génération rejouée) restent accessibles sans être proposées aux moteurs.
export const PUBLIC_PAGES = [
  "/",
  "/pricing",
  "/pipelines/demo-rome",
  "/pipelines/demo-compound-interest",
  "/cgu",
  "/confidentialite",
  "/charte",
  "/mentions-legales",
] as const;

// Jamais indexées : application connectée, administration, API, parcours de connexion.
export const PRIVATE_PREFIXES = ["/admin", "/api/", "/auth/", "/billing", "/dashboard", "/login", "/settings", "/w/", "/compte-supprime"] as const;
