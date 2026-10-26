import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { DATE_TIME } from "@/i18n/format";
import { NpsPrompt } from "@/components/nps-prompt";
import { PipelineStatusBadge } from "@/components/pipeline/pipeline-screen";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/lib/auth/session";
import { NPS_DISMISSED_COOKIE, shouldAskNps } from "@/lib/beta";
import { listPipelines, parseListParams, SEARCH_MAX_LENGTH, type PipelineListItem } from "@/lib/pipeline/list";
import { createClient } from "@/lib/supabase/server";
import { hasRole, requireMembership } from "@/lib/workspaces/access";
import { SAMPLE_BRIEF_KEYS } from "@/lib/pipeline/sample-briefs";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("dashboard") };
}
export const instant = false; // bloque avec le layout (vérification d'appartenance)


const listHref = (slug: string, q: string, page: number) => {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/w/${slug}/dashboard${query ? `?${query}` : ""}`;
};


async function PipelineRow({ slug, pipeline, canEdit }: { slug: string; pipeline: PipelineListItem; canEdit: boolean }) {
  const [t, format] = await Promise.all([getTranslations("Dashboard"), getFormatter()]);
  const details = [pipeline.niche, pipeline.durationMinutes && `${pipeline.durationMinutes} min`, pipeline.tier === "premium" && "Premium"]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border p-4">
      <div className="min-w-0 flex-1">
        <Link href={`/w/${slug}/pipelines/${pipeline.id}`} className="font-medium break-words hover:underline">
          {pipeline.title}
        </Link>
        <p className="mt-1 text-sm text-muted-foreground">
          {details} · <time dateTime={pipeline.createdAt}>{format.dateTime(new Date(pipeline.createdAt), DATE_TIME)}</time>
        </p>
      </div>
      <PipelineStatusBadge status={pipeline.status} />
      {canEdit && (
        <Link
          href={`/w/${slug}/pipelines/new?from=${pipeline.id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          aria-label={t("duplicateLabel", { title: pipeline.title })}
        >
          {t("duplicate")}
        </Link>
      )}
    </li>
  );
}

export default async function DashboardPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/dashboard">) {
  const { workspaceSlug } = await params;
  const { workspace, role } = await requireMembership(workspaceSlug);
  const { q, page } = parseListParams(await searchParams);
  const db = await createClient();
  const list = await listPipelines(db, workspace.id, { q, page });
  // Page au-delà de la dernière (lien ancien, pipelines supprimés) : vers la dernière page existante.
  if (list.items.length === 0 && list.total > 0) redirect(listHref(workspace.slug, q, list.pageCount));

  const canEdit = hasRole(role, "editor");
  // Question NPS de la bêta (tâche 5.6) : après le deuxième pipeline abouti, sauf « plus tard ».
  const askNps = !(await cookies()).has(NPS_DISMISSED_COOKIE) && (await shouldAskNps(db, (await requireUser()).id));
  const newPipelineHref = `/w/${workspace.slug}/pipelines/new`;
  const empty = list.total === 0 && !q; // aucun pipeline du tout, pas une recherche vide
  const t = await getTranslations("Dashboard");

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{workspace.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/w/${workspace.slug}/channels`} className={buttonVariants({ variant: "outline" })}>
            {t("channels")}
          </Link>
          {canEdit && !empty && (
            <Link href={newPipelineHref} className={buttonVariants()}>
              {t("new")}
            </Link>
          )}
        </div>
      </div>

      {askNps && <NpsPrompt />}

      {empty ? (
        <section className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-4 py-16 text-center">
          <h2 className="text-lg font-semibold">{t("emptyTitle")}</h2>
          <p className="max-w-md text-muted-foreground">
            {t("emptyText")}
          </p>
          {canEdit ? (
            <div className="flex flex-wrap justify-center gap-3">
              <Link href={newPipelineHref} className={buttonVariants({ size: "lg" })}>
                {t("emptyCta")}
              </Link>
              {/* Onboarding (tâche 5.4) : formulaire déjà rempli, il ne reste qu'à lancer. */}
              <Link href={`${newPipelineHref}?example=${SAMPLE_BRIEF_KEYS[0]}`} className={buttonVariants({ size: "lg", variant: "outline" })}>
                {t("emptySample")}
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("emptyViewer")}</p>
          )}
        </section>
      ) : (
        <>
          <form role="search" action={`/w/${workspace.slug}/dashboard`} className="mb-4 flex gap-2">
            <label htmlFor="q" className="sr-only">
              {t("searchLabel")}
            </label>
            <Input id="q" name="q" type="search" defaultValue={q} maxLength={SEARCH_MAX_LENGTH} placeholder={t("searchPlaceholder")} />
            <button type="submit" className={buttonVariants({ variant: "outline" })}>
              {t("search")}
            </button>
          </form>

          <p className="mb-3 text-sm text-muted-foreground">{q ? t("countFor", { count: list.total, q }) : t("count", { count: list.total })}</p>

          {list.items.length === 0 ? (
            <div className="rounded-xl border p-6 text-sm">
              <p>{t("noMatch")}</p>
              <Link href={listHref(workspace.slug, "", 1)} className="mt-2 inline-block font-medium underline underline-offset-4">
                {t("clear")}
              </Link>
            </div>
          ) : (
            <ul className="grid gap-3">
              {list.items.map((pipeline) => (
                <PipelineRow key={pipeline.id} slug={workspace.slug} pipeline={pipeline} canEdit={canEdit} />
              ))}
            </ul>
          )}

          {list.pageCount > 1 && (
            <nav aria-label={t("pagination")} className="mt-6 flex items-center justify-between gap-4 text-sm">
              {list.page > 1 ? (
                <Link href={listHref(workspace.slug, q, list.page - 1)} rel="prev" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {t("previous")}
                </Link>
              ) : (
                <span />
              )}
              <span>
                {t("page", { page: list.page, count: list.pageCount })}
              </span>
              {list.page < list.pageCount ? (
                <Link href={listHref(workspace.slug, q, list.page + 1)} rel="next" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {t("next")}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
