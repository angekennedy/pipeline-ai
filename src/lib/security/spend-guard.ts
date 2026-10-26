import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env/server";
import type { Database } from "@/lib/supabase/database.types";

// Disjoncteur de dépense (ARCHITECTURE §6) : la dépense LLM du jour (UTC), lue dans `generations`,
// comparée à un seuil global et à un seuil par workspace. Au-delà, aucune nouvelle génération n'est
// réservée ni lancée ; celles en cours se terminent. Un seuil de workspace atteint fait soupçonner
// un compte compromis ou un abus : les deux cas déclenchent une alerte.

export type SpendScope = "global" | "workspace";

export class SpendPausedError extends Error {
  readonly code = "SPEND_PAUSED";
  constructor(readonly scope: SpendScope) {
    super(`Disjoncteur de dépense déclenché (${scope})`);
    this.name = "SpendPausedError";
  }
}

export type SpendLimits = { globalUsd: number; workspaceUsd: number };

const DEFAULT_LIMITS: SpendLimits = {
  globalUsd: serverEnv.SPEND_DAILY_LIMIT_USD,
  workspaceUsd: serverEnv.SPEND_DAILY_WORKSPACE_LIMIT_USD,
};

const MICROS = 1_000_000;

export const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

// Sentry regroupe les alertes identiques : une par seuil et par workspace, pas une par demande refusée.
function alertSpend(scope: SpendScope, workspaceId: string, spentUsd: number, limitUsd: number) {
  Sentry.captureMessage(`Disjoncteur de dépense : seuil ${scope} atteint`, {
    level: "error",
    tags: { alert: "spend_guard", scope },
    extra: { workspaceId, spentUsd, limitUsd },
    fingerprint: ["spend_guard", scope, scope === "workspace" ? workspaceId : "all"],
  });
}

async function spentUsd(db: SupabaseClient<Database>, since: Date, workspaceId?: string): Promise<number> {
  const { data, error } = await db.rpc("spend_since", { p_since: since.toISOString(), p_workspace: workspaceId });
  if (error) throw Object.assign(new Error(`Dépense du jour : ${error.message}`), { code: error.code });
  return data / MICROS;
}

export async function enforceSpendGuard(
  db: SupabaseClient<Database>,
  workspaceId: string,
  { limits = DEFAULT_LIMITS, now = new Date(), alert = alertSpend }: { limits?: SpendLimits; now?: Date; alert?: typeof alertSpend } = {},
): Promise<void> {
  const since = startOfUtcDay(now);
  const [global, workspace] = await Promise.all([spentUsd(db, since), spentUsd(db, since, workspaceId)]);
  if (global >= limits.globalUsd) {
    alert("global", workspaceId, global, limits.globalUsd);
    throw new SpendPausedError("global");
  }
  if (workspace >= limits.workspaceUsd) {
    alert("workspace", workspaceId, workspace, limits.workspaceUsd);
    throw new SpendPausedError("workspace");
  }
}
