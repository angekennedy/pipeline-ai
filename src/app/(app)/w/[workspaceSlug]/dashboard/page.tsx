import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PipelineStatusBadge } from "@/components/pipeline/pipeline-screen";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listPipelines, parseListParams, SEARCH_MAX_LENGTH, type PipelineListItem } from "@/lib/pipeline/list";
import { createClient } from "@/lib/supabase/server";
import { hasRole, requireMembership } from "@/lib/workspaces/access";

export const metadata: Metadata = { title: "Tableau de bord · Pipeline AI" };
export const instant = false; // bloque avec le layout (vérification d'appartenance)

// Heure de Paris, comme l'interface : le rendu serveur ne dépend pas du fuseau de la machine.
const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });

const listHref = (slug: string, q: string, page: number) => {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/w/${slug}/dashboard${query ? `?${query}` : ""}`;
};

const plural = (count: number) => `${count} pipeline${count > 1 ? "s" : ""}`;

function PipelineRow({ slug, pipeline, canEdit }: { slug: string; pipeline: PipelineListItem; canEdit: boolean }) {
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
          {details} · <time dateTime={pipeline.createdAt}>{DATE.format(new Date(pipeline.createdAt))}</time>
        </p>
      </div>
      <PipelineStatusBadge status={pipeline.status} />
      {canEdit && (
        <Link
          href={`/w/${slug}/pipelines/new?from=${pipeline.id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          aria-label={`Dupliquer le brief « ${pipeline.title} »`}
        >
          Dupliquer
        </Link>
      )}
    </li>
  );
}

export default async function DashboardPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/dashboard">) {
  const { workspaceSlug } = await params;
  const { workspace, role } = await requireMembership(workspaceSlug);
  const { q, page } = parseListParams(await searchParams);
  const list = await listPipelines(await createClient(), workspace.id, { q, page });
  // Page au-delà de la dernière (lien ancien, pipelines supprimés) : vers la dernière page existante.
  if (list.items.length === 0 && list.total > 0) redirect(listHref(workspace.slug, q, list.pageCount));

  const canEdit = hasRole(role, "editor");
  const newPipelineHref = `/w/${workspace.slug}/pipelines/new`;
  const empty = list.total === 0 && !q; // aucun pipeline du tout, pas une recherche vide

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipelines</h1>
          <p className="mt-1 text-muted-foreground">{workspace.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/w/${workspace.slug}/channels`} className={buttonVariants({ variant: "outline" })}>
            Presets de chaîne
          </Link>
          {canEdit && !empty && (
            <Link href={newPipelineHref} className={buttonVariants()}>
              Nouveau pipeline
            </Link>
          )}
        </div>
      </div>

      {empty ? (
        <section className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-4 py-16 text-center">
          <h2 className="text-lg font-semibold">Aucun pipeline pour l&apos;instant</h2>
          <p className="max-w-md text-muted-foreground">
            Un brief suffit : le script, les titres, le SEO, la voix off et les miniatures sont générés à partir de lui.
          </p>
          {canEdit ? (
            <Link href={newPipelineHref} className={buttonVariants({ size: "lg" })}>
              Créer mon premier pipeline
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">Les pipelines créés par les éditeurs de ce workspace apparaîtront ici.</p>
          )}
        </section>
      ) : (
        <>
          <form role="search" action={`/w/${workspace.slug}/dashboard`} className="mb-4 flex gap-2">
            <label htmlFor="q" className="sr-only">
              Rechercher un pipeline par sujet
            </label>
            <Input id="q" name="q" type="search" defaultValue={q} maxLength={SEARCH_MAX_LENGTH} placeholder="Rechercher par sujet" />
            <button type="submit" className={buttonVariants({ variant: "outline" })}>
              Rechercher
            </button>
          </form>

          <p className="mb-3 text-sm text-muted-foreground">{q ? `${plural(list.total)} pour « ${q} »` : plural(list.total)}</p>

          {list.items.length === 0 ? (
            <div className="rounded-xl border p-6 text-sm">
              <p>Aucun pipeline ne correspond à cette recherche.</p>
              <Link href={listHref(workspace.slug, "", 1)} className="mt-2 inline-block font-medium underline underline-offset-4">
                Effacer la recherche
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
            <nav aria-label="Pagination" className="mt-6 flex items-center justify-between gap-4 text-sm">
              {list.page > 1 ? (
                <Link href={listHref(workspace.slug, q, list.page - 1)} rel="prev" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Précédent
                </Link>
              ) : (
                <span />
              )}
              <span>
                Page {list.page} sur {list.pageCount}
              </span>
              {list.page < list.pageCount ? (
                <Link href={listHref(workspace.slug, q, list.page + 1)} rel="next" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Suivant
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
