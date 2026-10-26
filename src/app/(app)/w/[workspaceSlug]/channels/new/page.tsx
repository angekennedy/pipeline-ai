import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChannelForm } from "@/components/channels/channel-form";
import { requireMembership } from "@/lib/workspaces/access";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("newChannel") };
}
export const instant = false; // bloque avec le layout (vérification d'appartenance)

export default async function NewChannelPage({ params }: PageProps<"/w/[workspaceSlug]/channels/new">) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMembership(workspaceSlug, "editor");
  const t = await getTranslations("Channels");

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Link href={`/w/${workspace.slug}/channels`} className="text-sm text-muted-foreground hover:text-foreground">
        {t("back")}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("newTitle")}</h1>
      <p className="mt-1 mb-8 text-muted-foreground">{t("newIntro")}</p>
      <ChannelForm workspaceSlug={workspace.slug} />
    </main>
  );
}
