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
  pipelineToZip,
  type ExportFormat,
} from "@/lib/export/document";
import { loadPipelineView } from "@/lib/pipeline/load-view";
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
  if (!(await getUser())) return new Response(t("Export.signIn"), { status: 401 });

  const db = await createClient();
  const { data: pipeline, error } = await db.from("pipelines").select("workspace_id").eq("id", id).maybeSingle();
  if (error) throw new Error(`Export du pipeline ${id} : ${error.message}`);
  if (!pipeline) return notFound();
  const view = await loadPipelineView(db, pipeline.workspace_id, id);
  if (!view) return notFound();

  const body =
    format.data === "md"
      ? pipelineToMarkdown(view, t)
      : format.data === "json"
        ? pipelineToJson(view, t)
        : format.data === "txt"
          ? pipelineToSpeech(view)
          : format.data === "srt"
            ? pipelineToSrt(view)
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
