import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_PATH, isAppRoute, safeNext, workspaceTarget, type WorkspaceTarget } from "@/lib/auth/routes";
import { publicEnv } from "@/lib/env/public";
import type { Database } from "./database.types";

// Rafraîchit la session Supabase avant chaque requête et propage les cookies. Filtre optimiste
// ensuite : une route de l'application sans session renvoie vers /login, une session ouverte sur
// /login renvoie vers sa destination.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Ne rien exécuter entre la création du client et cet appel :
  // il déclenche le rafraîchissement du jeton.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const { pathname, search } = request.nextUrl;
  if (!signedIn && isAppRoute(pathname)) {
    const login = new URL(LOGIN_PATH, request.url);
    login.searchParams.set("next", pathname + search);
    return redirectWithCookies(login, response);
  }
  if (signedIn && pathname === LOGIN_PATH) {
    return redirectWithCookies(new URL(safeNext(request.nextUrl.searchParams.get("next")), request.url), response);
  }

  // Workspace ou pipeline hors de portée : un vrai 404, décidé avant le rendu. Dans la page, le
  // streaming (en-tête sous <Suspense>) commence avant la vérification et figerait un statut 200.
  // Lecture sous RLS, une ou deux requêtes par clé primaire ou index unique. Le layout et la page
  // revérifient de leur côté.
  const target = signedIn ? workspaceTarget(pathname) : null;
  if (target && !(await canReach(supabase, target))) {
    const notFound = NextResponse.rewrite(new URL("/introuvable", request.url));
    response.cookies.getAll().forEach((cookie) => notFound.cookies.set(cookie));
    return notFound;
  }
  return response;
}

async function canReach(supabase: SupabaseClient<Database>, { slug, resource, invalid }: WorkspaceTarget) {
  if (invalid) return false;
  const { data: workspace } = await supabase.from("workspaces").select("id").eq("slug", slug).maybeSingle();
  if (!workspace) return false;
  if (!resource) return true;
  const { data } = await supabase.from(resource.table).select("id").eq("id", resource.id).eq("workspace_id", workspace.id).maybeSingle();
  return Boolean(data);
}

// Une redirection garde les cookies de session que le rafraîchissement vient de poser, et l'en-tête
// anti-cache qui les accompagne.
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  const cacheControl = from.headers.get("cache-control");
  if (cacheControl) redirect.headers.set("cache-control", cacheControl);
  return redirect;
}
