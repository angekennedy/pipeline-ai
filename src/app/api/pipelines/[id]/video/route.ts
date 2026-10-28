import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { getUser } from "@/lib/auth/session";
import { exportBaseName } from "@/lib/export/document";
import { loadPipelineView } from "@/lib/pipeline/load-view";
import { enforceRateLimit, RateLimitedError } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isShotstackUrl } from "@/lib/video/manifest";

// Téléchargement du MP4 : le fichier est hébergé par Shotstack, sur un autre domaine, où le navigateur
// ignore l'attribut `download` et ouvre la vidéo. La route le relaie en flux avec
// `Content-Disposition: attachment`, après les mêmes vérifications que l'export (session, RLS).

// Une vidéo d'une heure pèse 1 à 2 Go : le relais doit tenir dans une invocation.
export const maxDuration = 300;

export async function GET(_request: Request, { params }: RouteContext<"/api/pipelines/[id]/video">): Promise<Response> {
  const { id } = await params;
  const t = await getTranslations();
  const notFound = () => new Response(t("Export.notFound"), { status: 404 });
  if (!z.uuid().safeParse(id).success) return notFound();
  const user = await getUser();
  if (!user) return new Response(t("Export.signIn"), { status: 401 });
  try {
    await enforceRateLimit(createAdminClient(), [{ rule: "exportUser", subject: user.id }]);
  } catch (error) {
    if (!(error instanceof RateLimitedError)) throw error;
    return new Response(t("Export.rateLimited"), { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
  }

  const db = await createClient();
  const { data: pipeline, error } = await db.from("pipelines").select("workspace_id").eq("id", id).maybeSingle();
  if (error) throw new Error(`Vidéo du pipeline ${id} : ${error.message}`);
  if (!pipeline) return notFound();
  const view = await loadPipelineView(db, pipeline.workspace_id, id);
  if (!view) return notFound();
  const video = view.video?.status === "ready" ? view.video.content : null;
  if (!video) return new Response(t("Export.notReady"), { status: 409 });
  // L'URL vient de la base, écrite par le worker : seuls les hôtes de Shotstack sont relayés.
  if (!isShotstackUrl(video.url)) throw new Error(`Vidéo du pipeline ${id} : hôte inattendu`);

  const upstream = await fetch(video.url, { signal: AbortSignal.timeout(maxDuration * 1000) });
  if (!upstream.ok || !upstream.body) return new Response(t("Export.notReady"), { status: 502 });
  const length = upstream.headers.get("content-length");
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "video/mp4",
      ...(length && { "Content-Length": length }),
      "Content-Disposition": `attachment; filename="${exportBaseName(view)}.mp4"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
