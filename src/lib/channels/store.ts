import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChannelPresetSchema, type ChannelPreset } from "@/lib/ai/schemas";
import { PlanRestrictionError, restrictionFromDetails } from "@/lib/billing/entitlements";
import type { Database, Json } from "@/lib/supabase/database.types";

// Presets de chaîne d'un workspace (table `channels`), lus et écrits avec le client de l'utilisateur :
// la RLS réserve l'écriture aux éditeurs (ch_write), le trigger channels_plan_limit refuse un preset
// de plus que le plan n'en permet (PlanRestrictionError).

export type Channel = { id: string; preset: ChannelPreset; updatedAt: string };

type Row = Database["public"]["Tables"]["channels"]["Row"];
const COLUMNS = "id, name, niche, default_language, tone, style, audience, voice_profile, brand_rules, updated_at";

// Une ligne qui ne passe plus la validation (écrite hors de l'application) est écartée, pas affichée.
function toChannel(row: Pick<Row, "id" | "name" | "niche" | "default_language" | "tone" | "style" | "audience" | "voice_profile" | "brand_rules" | "updated_at">): Channel | null {
  const preset = ChannelPresetSchema.safeParse({
    name: row.name,
    niche: row.niche,
    defaultLanguage: row.default_language,
    tone: row.tone ?? undefined,
    style: row.style ?? undefined,
    audience: row.audience ?? undefined,
    voiceProfile: row.voice_profile,
    brandRules: row.brand_rules,
  });
  return preset.success ? { id: row.id, preset: preset.data, updatedAt: row.updated_at } : null;
}

function toRow(preset: ChannelPreset) {
  return {
    name: preset.name,
    niche: preset.niche,
    default_language: preset.defaultLanguage,
    tone: preset.tone ?? null,
    style: preset.style ?? null,
    audience: preset.audience ?? null,
    voice_profile: preset.voiceProfile as NonNullable<Json>,
    brand_rules: preset.brandRules as NonNullable<Json>,
  };
}

function failure(action: string, error: { message: string; details: string; code: string }): never {
  if (error.message === "PLAN_RESTRICTED") throw new PlanRestrictionError(restrictionFromDetails(error.details));
  throw Object.assign(new Error(`${action} : ${error.message}`), { code: error.code });
}

export async function listChannels(db: SupabaseClient<Database>, workspaceId: string): Promise<Channel[]> {
  const { data, error } = await db.from("channels").select(COLUMNS).eq("workspace_id", workspaceId).order("name").order("id");
  if (error) failure(`Presets du workspace ${workspaceId}`, error);
  return data.flatMap((row) => toChannel(row) ?? []);
}

export async function getChannel(db: SupabaseClient<Database>, workspaceId: string, channelId: string): Promise<Channel | null> {
  const { data, error } = await db.from("channels").select(COLUMNS).eq("id", channelId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) failure(`Preset ${channelId}`, error);
  return data ? toChannel(data) : null;
}

export async function createChannel(db: SupabaseClient<Database>, workspaceId: string, preset: ChannelPreset): Promise<string> {
  const { data, error } = await db.from("channels").insert({ workspace_id: workspaceId, ...toRow(preset) }).select("id").single();
  if (error) failure("Création du preset", error);
  return data.id;
}

// Les pipelines déjà créés gardent leur copie (`channel_snapshot`) : modifier le preset ne les change pas.
// Renvoie false si le preset n'existe pas ou n'est pas modifiable par cet utilisateur.
export async function updateChannel(db: SupabaseClient<Database>, workspaceId: string, channelId: string, preset: ChannelPreset): Promise<boolean> {
  const { data, error } = await db
    .from("channels")
    .update({ ...toRow(preset), updated_at: new Date().toISOString() })
    .eq("id", channelId)
    .eq("workspace_id", workspaceId)
    .select("id");
  if (error) failure(`Modification du preset ${channelId}`, error);
  return data.length > 0;
}

// `pipelines.channel_id` passe à null (on delete set null) ; la copie figée reste dans chaque pipeline.
export async function deleteChannel(db: SupabaseClient<Database>, workspaceId: string, channelId: string): Promise<boolean> {
  const { data, error } = await db.from("channels").delete().eq("id", channelId).eq("workspace_id", workspaceId).select("id");
  if (error) failure(`Suppression du preset ${channelId}`, error);
  return data.length > 0;
}
