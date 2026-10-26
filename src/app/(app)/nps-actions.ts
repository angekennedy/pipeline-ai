"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/session";
import { NPS_DISMISSED_COOKIE, NpsSchema } from "@/lib/beta";
import { createClient } from "@/lib/supabase/server";

// Question NPS de la bêta (tâche 5.6). La réponse s'écrit sous RLS, avec le client de l'utilisateur :
// une seule par personne, modifiable.

export type NpsState = { sent?: true; error?: "score" };

const DISMISS_SECONDS = 30 * 24 * 3600;

export async function submitNps(_previous: NpsState, formData: FormData): Promise<NpsState> {
  const user = await requireUser();
  const parsed = NpsSchema.safeParse({ score: formData.get("score") ?? undefined, comment: String(formData.get("comment") ?? "") || undefined });
  if (!parsed.success) return { error: "score" };
  const db = await createClient();
  const { error } = await db
    .from("nps_responses")
    .upsert({ user_id: user.id, score: parsed.data.score, comment: parsed.data.comment ?? null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(`Réponse NPS de ${user.id} : ${error.message}`);
  return { sent: true };
}

// « Plus tard » : la question revient dans 30 jours.
export async function dismissNps(): Promise<void> {
  await requireUser();
  (await cookies()).set(NPS_DISMISSED_COOKIE, "1", { path: "/", maxAge: DISMISS_SECONDS, sameSite: "lax", httpOnly: true });
  refresh();
}
