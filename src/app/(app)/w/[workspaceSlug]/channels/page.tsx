import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PLANS } from "@/lib/billing/plans";
import { listChannels } from "@/lib/channels/store";
import { LANGUAGE_LABELS, TONE_LABELS } from "@/lib/pipeline/labels";
import { createClient } from "@/lib/supabase/server";
import { hasRole, requireMembership } from "@/lib/workspaces/access";

export const metadata: Metadata = { title: "Presets de chaîne · Pipeline AI" };
export const instant = false; // bloque avec le layout (vérification d'appartenance)

export default async function ChannelsPage({ params }: PageProps<"/w/[workspaceSlug]/channels">) {
  const { workspaceSlug } = await params;
  const { workspace, role, credits } = await requireMembership(workspaceSlug);
  const channels = await listChannels(await createClient(), workspace.id);
  const plan = PLANS[credits.planKey];
  const canEdit = hasRole(role, "editor");
  const full = channels.length >= plan.channelPresets;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <Link href={`/w/${workspace.slug}/dashboard`} className="text-sm text-muted-foreground hover:text-foreground">
        ← Tous les pipelines
      </Link>
      <div className="mt-4 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Presets de chaîne</h1>
          <p className="mt-1 text-muted-foreground">
            {channels.length} sur {plan.channelPresets} avec le plan {plan.name}. Un preset préremplit le brief et guide le ton, la voix et
            les règles de marque de chaque asset.
          </p>
        </div>
        {canEdit && !full && (
          <Link href={`/w/${workspace.slug}/channels/new`} className={buttonVariants()}>
            Nouveau preset
          </Link>
        )}
      </div>

      {canEdit && full && (
        <p role="status" className="mb-4 rounded-xl border p-4 text-sm">
          Le plan {plan.name} est limité à {plan.channelPresets} {plan.channelPresets > 1 ? "presets" : "preset"}. Supprimez-en un, ou{" "}
          <Link href="/pricing" className="font-medium underline underline-offset-4">
            passez à un plan supérieur
          </Link>
          .
        </p>
      )}

      {channels.length === 0 ? (
        <section className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-4 py-16 text-center">
          <h2 className="text-lg font-semibold">Aucun preset pour l&apos;instant</h2>
          <p className="max-w-md text-muted-foreground">
            Enregistrez une fois la niche, le ton, la voix et les règles de marque de votre chaîne : chaque brief les reprend.
          </p>
          {canEdit && (
            <Link href={`/w/${workspace.slug}/channels/new`} className={buttonVariants({ size: "lg" })}>
              Créer mon premier preset
            </Link>
          )}
        </section>
      ) : (
        <ul className="grid gap-3">
          {channels.map(({ id, preset }) => (
            <li key={id} className="rounded-xl border p-4">
              {canEdit ? (
                <Link href={`/w/${workspace.slug}/channels/${id}`} className="font-medium hover:underline">
                  {preset.name}
                </Link>
              ) : (
                <span className="font-medium">{preset.name}</span>
              )}
              <p className="mt-1 text-sm text-muted-foreground">
                {[preset.niche, LANGUAGE_LABELS[preset.defaultLanguage], preset.tone && TONE_LABELS[preset.tone]].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
