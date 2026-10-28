import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { effectivePlan } from "@/lib/billing/balance";
import { listChannels } from "@/lib/channels/store";
import { createClient } from "@/lib/supabase/server";
import { hasRole, requireMembership } from "@/lib/workspaces/access";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("channels") };
}
export const instant = false; // bloque avec le layout (vérification d'appartenance)

export default async function ChannelsPage({ params }: PageProps<"/w/[workspaceSlug]/channels">) {
  const { workspaceSlug } = await params;
  const { workspace, role, credits } = await requireMembership(workspaceSlug);
  const channels = await listChannels(await createClient(), workspace.id);
  const plan = effectivePlan(credits);
  const canEdit = hasRole(role, "editor");
  const full = channels.length >= plan.channelPresets;
  const t = await getTranslations("Channels");
  const labels = await getTranslations("Labels");

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <Link href={`/w/${workspace.slug}/dashboard`} className="text-sm text-muted-foreground hover:text-foreground">
        {t("allPipelines")}
      </Link>
      <div className="mt-4 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">
            {t("intro", { count: channels.length, max: plan.channelPresets, plan: plan.name })}
          </p>
        </div>
        {canEdit && !full && (
          <Link href={`/w/${workspace.slug}/channels/new`} className={buttonVariants()}>
            {t("new")}
          </Link>
        )}
      </div>

      {canEdit && full && (
        <p role="status" className="mb-4 rounded-xl border p-4 text-sm">
          {t.rich("full", {
            plan: plan.name,
            max: plan.channelPresets,
            link: (chunks) => (
              <Link href="/pricing" className="font-medium underline underline-offset-4">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}

      {channels.length === 0 ? (
        <section className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-4 py-16 text-center">
          <h2 className="text-lg font-semibold">{t("emptyTitle")}</h2>
          <p className="max-w-md text-muted-foreground">
            {t("emptyText")}
          </p>
          {canEdit && (
            <Link href={`/w/${workspace.slug}/channels/new`} className={buttonVariants({ size: "lg" })}>
              {t("emptyCta")}
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
                {[preset.niche, labels(`language.${preset.defaultLanguage}`), preset.tone && labels(`tone.${preset.tone}`)].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
