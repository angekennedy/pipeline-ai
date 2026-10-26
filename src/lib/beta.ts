import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";

// Bêta fermée (tâche 5.6, migration 0015) : inscriptions sur invitation et question NPS. Le mode bêta
// se règle depuis /admin, sans redéploiement ; le trigger beta_gate refuse en base toute inscription
// non invitée, quelle que soit la voie.

type Db = SupabaseClient<Database>;

function unwrap<T>({ data, error }: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (error) throw Object.assign(new Error(`${what} : ${error.message}`), { code: error.code });
  return data;
}

// Service role. Vrai hors mode bêta, pour une adresse invitée, ou pour un compte existant.
export const canSignIn = async (admin: Db, email: string) => unwrap(await admin.rpc("beta_can_sign_in", { p_email: email }), "Invitation");

const InviteSchema = z.object({ email: z.string(), note: z.string().nullable(), invited_at: z.string() });
export type BetaInvite = { email: string; note: string | null; invitedAt: string };

export async function betaSettings(admin: Db): Promise<{ inviteOnly: boolean; invites: BetaInvite[] }> {
  const [row] = unwrap(await admin.rpc("beta_settings"), "Réglages de la bêta") ?? [];
  const invites = z.array(InviteSchema).parse(row?.invites ?? []);
  return { inviteOnly: row?.invite_only ?? false, invites: invites.map(({ email, note, invited_at }) => ({ email, note, invitedAt: invited_at })) };
}

export const inviteOnly = async (admin: Db) => (await betaSettings(admin)).inviteOnly;

export async function setInviteOnly(admin: Db, enabled: boolean) {
  unwrap(await admin.rpc("set_beta_invite_only", { p_enabled: enabled }), "Mode bêta");
}

export async function addInvite(admin: Db, email: string, note?: string) {
  unwrap(await admin.rpc("add_beta_invite", { p_email: email, p_note: note }), `Invitation de ${email}`);
}

export async function removeInvite(admin: Db, email: string) {
  unwrap(await admin.rpc("remove_beta_invite", { p_email: email }), `Invitation de ${email}`);
}

// NPS : % de promoteurs (9-10) − % de détracteurs (0-6), de −100 à 100 ; null sans réponse.
export type NpsSummary = { responses: number; promoters: number; passives: number; detractors: number; score: number | null };

export const npsScore = ({ responses, promoters, detractors }: Omit<NpsSummary, "score">) =>
  responses === 0 ? null : Math.round(((promoters - detractors) / responses) * 100);

export async function npsSummary(admin: Db): Promise<NpsSummary> {
  const [row] = unwrap(await admin.rpc("nps_summary"), "Synthèse NPS") ?? [];
  const counts = { responses: row?.responses ?? 0, promoters: row?.promoters ?? 0, passives: row?.passives ?? 0, detractors: row?.detractors ?? 0 };
  return { ...counts, score: npsScore(counts) };
}

// La question est posée après le deuxième pipeline abouti de l'utilisateur, une seule fois : sous
// RLS, l'utilisateur ne lit que sa propre réponse et ses pipelines.
export const NPS_AFTER_PIPELINES = 2;
export const NPS_DISMISSED_COOKIE = "nps_dismissed"; // « plus tard » : posé 30 jours par dismissNps

export async function shouldAskNps(db: Db, userId: string): Promise<boolean> {
  const [answered, pipelines] = await Promise.all([
    db.from("nps_responses").select("user_id").eq("user_id", userId).maybeSingle(),
    db.from("pipelines").select("id", { count: "exact", head: true }).eq("created_by", userId).in("status", ["completed", "partial"]),
  ]);
  const response = unwrap(answered, "Réponse NPS");
  unwrap(pipelines, "Pipelines aboutis");
  return !response && (pipelines.count ?? 0) >= NPS_AFTER_PIPELINES;
}

export type NpsComment = { score: number; comment: string; updatedAt: string };

// Derniers commentaires laissés avec une note, pour /admin (service role).
export async function recentNpsComments(admin: Db, limit = 20): Promise<NpsComment[]> {
  const rows = unwrap(
    await admin.from("nps_responses").select("score, comment, updated_at").not("comment", "is", null).order("updated_at", { ascending: false }).limit(limit),
    "Commentaires NPS",
  );
  return (rows ?? []).map((row) => ({ score: row.score, comment: row.comment!, updatedAt: row.updated_at }));
}

export const NpsSchema = z.object({ score: z.coerce.number().int().min(0).max(10), comment: z.string().trim().max(1000).optional() });
