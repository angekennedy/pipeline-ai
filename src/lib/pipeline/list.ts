import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BriefSchema } from "@/lib/ai/schemas";
import type { Database } from "@/lib/supabase/database.types";
import { briefToFormValues, type BriefFormValues } from "./brief-form";
import type { ModelTier } from "./registry";
import type { PipelineStatus } from "./status";

// Tableau de bord d'un workspace : pipelines du plus récent au plus ancien, par pages, avec une
// recherche sur le sujet. Lu avec le client de l'utilisateur : la RLS limite aux workspaces dont il est
// membre, le filtre par workspace à celui de l'URL.

export const PAGE_SIZE = 20;
export const SEARCH_MAX_LENGTH = 100;

export type ListParams = { q: string; page: number };
export type PipelineListItem = {
  id: string;
  title: string;
  status: PipelineStatus;
  niche: string;
  durationMinutes: number | null;
  tier: ModelTier;
  createdAt: string;
};
export type PipelineList = { items: PipelineListItem[]; total: number; page: number; pageCount: number };

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// `?q=…&page=N` : une valeur absente ou invalide retombe sur la première page, sans recherche.
export function parseListParams(params: SearchParams): ListParams {
  const q = (first(params.q) ?? "").trim().slice(0, SEARCH_MAX_LENGTH);
  const raw = first(params.page) ?? "";
  const page = /^\d{1,6}$/.test(raw) ? Math.max(1, Number(raw)) : 1;
  return { q, page };
}

// Les jokers de LIKE saisis par l'utilisateur sont cherchés tels quels.
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

const pageCount = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));

export async function listPipelines(db: SupabaseClient<Database>, workspaceId: string, { q, page }: ListParams): Promise<PipelineList> {
  const filtered = () => {
    let query = db
      .from("pipelines")
      .select("id, title, status, model_tier, created_at, niche:brief->>niche, duration:brief->durationMinutes", { count: "exact" })
      .eq("workspace_id", workspaceId);
    if (q) query = query.ilike("title", `%${escapeLike(q)}%`);
    return query;
  };

  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await filtered()
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  // Page au-delà de la dernière : PostgREST répond 416 (PGRST103) sans le total, relu à part.
  if (error?.code === "PGRST103") {
    const { count: total, error: countError } = await filtered().limit(0);
    if (countError) throw new Error(`Pipelines du workspace ${workspaceId} : ${countError.message}`);
    return { items: [], total: total ?? 0, page, pageCount: pageCount(total ?? 0) };
  }
  if (error) throw new Error(`Pipelines du workspace ${workspaceId} : ${error.message}`);

  const total = count ?? 0;
  return {
    items: data.map((row) => ({
      id: row.id,
      title: row.title ?? "",
      status: row.status,
      niche: typeof row.niche === "string" ? row.niche : "",
      durationMinutes: typeof row.duration === "number" ? row.duration : null,
      tier: row.model_tier === "premium" ? "premium" : "standard",
      createdAt: row.created_at,
    })),
    total,
    page,
    pageCount: pageCount(total),
  };
}

// Brief d'un pipeline du workspace, prêt à préremplir le formulaire de création. Null si le pipeline
// n'existe pas, n'est pas dans ce workspace, ou si son brief ne passe plus la validation.
export async function loadBriefValues(
  db: SupabaseClient<Database>,
  workspaceId: string,
  pipelineId: string,
): Promise<{ title: string; values: BriefFormValues } | null> {
  const { data, error } = await db
    .from("pipelines")
    .select("brief, model_tier")
    .eq("id", pipelineId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Brief du pipeline ${pipelineId} : ${error.message}`);
  if (!data) return null;
  const brief = BriefSchema.safeParse(data.brief);
  if (!brief.success) return null;
  return { title: brief.data.topic, values: briefToFormValues(brief.data, data.model_tier === "premium" ? "premium" : "standard") };
}
