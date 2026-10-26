// Routes de l'application connectée (groupe `(app)`, ARCHITECTURE §2) : le proxy renvoie vers
// /login sans session. Ce n'est qu'un filtre optimiste, sur le cookie : chaque page et chaque Server
// Action revérifie l'utilisateur (src/lib/auth/session.ts).
export const APP_ROUTE_PREFIXES = ["/dashboard", "/pipelines/new", "/w", "/settings"] as const;

export const LOGIN_PATH = "/login";

// Cookie qui garde la page demandée le temps du parcours de connexion (lien magique ou Google).
export const NEXT_COOKIE = "auth_next";

// Ressource d'un workspace visée par l'URL : /w/<slug>[/pipelines/<id> | /channels/<id>]. `resource`
// vaut null pour les autres pages du workspace (`new` compris).
const WORKSPACE_PATH = /^\/w\/([^/]+)(?:\/(pipelines|channels)\/([^/]+))?/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WorkspaceTarget = { slug: string; resource: { table: "pipelines" | "channels"; id: string } | null; invalid: boolean };

export function workspaceTarget(pathname: string): WorkspaceTarget | null {
  const match = WORKSPACE_PATH.exec(pathname);
  if (!match) return null;
  const [, slug, table, segment] = match;
  const resource = segment && segment !== "new" ? { table: table as "pipelines" | "channels", id: segment } : null;
  return { slug: slug!, resource, invalid: resource !== null && !UUID.test(resource.id) };
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
