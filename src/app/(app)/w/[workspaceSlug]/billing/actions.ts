"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { itemForLookupKey } from "@/lib/billing/plans";
import { AlreadySubscribedError, BillingUnavailableError, createCheckoutSession, createPortalSession, getStripe } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { findMembership, hasRole } from "@/lib/workspaces/access";

export type BillingState = { error?: string };

// La facturation d'un workspace est réservée à ses admins, revérifiés ici (action appelable
// directement). L'origine des URL de retour vient de la requête, comme pour la connexion Google.
async function adminOf(slug: string) {
  const user = await requireUser(`/w/${slug}/billing`);
  const membership = await findMembership(await createClient(), user.id, slug);
  if (!membership || !hasRole(membership.role, "admin")) throw new Error("Workspace introuvable ou rôle insuffisant");
  const origin = (await headers()).get("origin");
  if (!origin) throw new Error("Origine de la requête absente");
  return { user, workspace: membership.workspace, origin };
}

const failure = (error: unknown): BillingState => {
  if (error instanceof AlreadySubscribedError || error instanceof BillingUnavailableError) return { error: error.message };
  throw error;
};

export async function startCheckout(_previous: BillingState, formData: FormData): Promise<BillingState> {
  const { user, workspace, origin } = await adminOf(String(formData.get("workspaceSlug") ?? ""));
  const item = itemForLookupKey(String(formData.get("lookupKey") ?? ""));
  if (!item) throw new Error("Offre inconnue");
  let url: string;
  try {
    url = await createCheckoutSession(getStripe(), createAdminClient(), { workspace, email: user.email, item, origin });
  } catch (error) {
    return failure(error);
  }
  redirect(url);
}

export async function openPortal(_previous: BillingState, formData: FormData): Promise<BillingState> {
  const { workspace, origin } = await adminOf(String(formData.get("workspaceSlug") ?? ""));
  let url: string;
  try {
    url = await createPortalSession(getStripe(), createAdminClient(), { workspace, origin });
  } catch (error) {
    return failure(error);
  }
  redirect(url);
}
