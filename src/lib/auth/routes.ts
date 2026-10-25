// Routes de l'application connectée (groupe `(app)`, ARCHITECTURE §2) : le proxy renvoie vers
// /login sans session. Ce n'est qu'un filtre optimiste, sur le cookie : chaque page et chaque Server
// Action revérifie l'utilisateur (src/lib/auth/session.ts).
export const APP_ROUTE_PREFIXES = ["/pipelines/new", "/w", "/settings"] as const;

export const LOGIN_PATH = "/login";

// Cookie qui garde la page demandée le temps du parcours de connexion (lien magique ou Google).
export const NEXT_COOKIE = "auth_next";

export function isAppRoute(pathname: string): boolean {
  return APP_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Destination après connexion : un chemin interne uniquement. Une URL absolue, `//hôte` ou `/\hôte`
// mènerait hors du site (redirection ouverte).
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
