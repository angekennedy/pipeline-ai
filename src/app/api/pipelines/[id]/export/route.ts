import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { getUser } from "@/lib/auth/session";
import {
  EXPORT_FORMATS,
  exportBaseName,
  pipelineToJson,
  pipelineToMarkdown,
  pipelineToSpeech,
  pipelineToSrt,
  mediaEntries,
  pipelineToZip,
  pipelineToZipStream,
  type ExportFormat,
} from "@/lib/export/document";
import { supabaseMediaStorage } from "@/lib/media/storage";
import { loadPipelineView } from "@/lib/pipeline/load-view";
import { enforceRateLimit, RateLimitedError } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Téléchargement d'un export (tâche 4.1, ARCHITECTURE §2 : les GET de téléchargement passent par un
// Route Handler). Lu avec le client de l'utilisateur : la RLS limite aux pipelines de ses workspaces,
// un pipeline d'un autre workspace reçoit un 404 comme un pipeline inexistant.

const FormatSchema = z.enum(EXPORT_FORMATS as [ExportFormat, ...ExportFormat[]]);

const CONTENT: Record<ExportFormat, { type: string; extension: string }> = {
  md: { type: "text/markdown; charset=utf-8", extension: "md" },
  json: { type: "application/json; charset=utf-8", extension: "json" },
  txt: { type: "text/plain; charset=utf-8", extension: "voix-off.txt" },
  srt: { type: "application/x-subrip; charset=utf-8", extension: "srt" },
  zip: { type: "application/zip", extension: "zip" },
};

export async function GET(request: Request, { params }: RouteContext<"/api/pipelines/[id]/export">): Promise<Response> {
  const { id } = await params;
  const t = await getTranslations();
  const notFound = () => new Response(t("Export.notFound"), { status: 404 });
  const format = FormatSchema.safeParse(new URL(request.url).searchParams.get("format"));
  if (!format.success) return new Response(t("Export.unknownFormat", { formats: EXPORT_FORMATS.join(", ") }), { status: 400 });
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
  if (error) throw new Error(`Export du pipeline ${id} : ${error.message}`);
  if (!pipeline) return notFound();
  const view = await loadPipelineView(db, pipeline.workspace_id, id);
  if (!view) return notFound();

  // Archive avec médias (images, voix off, plans de la vidéo) : produite en flux, lue avec le client
  // de l'utilisateur (policy du bucket).
  const zipStream = format.data === "zip" && view.assets.script.status === "ready" && mediaEntries(view).length > 0;

  const body =
    format.data === "md"
      ? pipelineToMarkdown(view, t)
      : format.data === "json"
        ? pipelineToJson(view, t)
        : format.data === "txt"
          ? pipelineToSpeech(view)
          : format.data === "srt"
            ? pipelineToSrt(view)
            : zipStream
              ? pipelineToZipStream(view, t, (path) => supabaseMediaStorage(db).download(path))
              : pipelineToZip(view, t);
  if (body === null) return new Response(t("Export.notReady"), { status: 409 });

  const { type, extension } = CONTENT[format.data];
  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${exportBaseName(view)}.${extension}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
