// Routes de l'application connectée (groupe `(app)`, ARCHITECTURE §2) : le proxy renvoie vers
// /login sans session. Ce n'est qu'un filtre optimiste, sur le cookie : chaque page et chaque Server
// Action revérifie l'utilisateur (src/lib/auth/session.ts).
export const APP_ROUTE_PREFIXES = ["/pipelines/new", "/w", "/settings"] as const;

export const LOGIN_PATH = "/login";

// Cookie qui garde la page demandée le temps du parcours de connexion (lien magique ou Google).
export const NEXT_COOKIE = "auth_next";

// Ressource d'un workspace visée par l'URL : /w/<slug>[/pipelines/<id>]. `pipelineId` vaut null pour
// les autres pages du workspace (`new` compris).
const WORKSPACE_PATH = /^\/w\/([^/]+)(?:\/pipelines\/([^/]+))?/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function workspaceTarget(pathname: string): { slug: string; pipelineId: string | null; invalid: boolean } | null {
  const match = WORKSPACE_PATH.exec(pathname);
  if (!match) return null;
  const [, slug, segment] = match;
  const pipelineId = segment && segment !== "new" ? segment : null;
  return { slug: slug!, pipelineId, invalid: pipelineId !== null && !UUID.test(pipelineId) };
}

export function isAppRoute(pathname: string): boolean {
  return APP_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Destination après connexion : un chemin interne uniquement. Une URL absolue, `//hôte` ou `/\hôte`
// mènerait hors du site (redirection ouverte).
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
