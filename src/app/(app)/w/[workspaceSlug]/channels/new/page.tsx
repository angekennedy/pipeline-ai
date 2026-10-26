import type { Metadata } from "next";
import Link from "next/link";
import { ChannelForm } from "@/components/channels/channel-form";
import { requireMembership } from "@/lib/workspaces/access";

export const metadata: Metadata = { title: "Nouveau preset · Pipeline AI" };
export const instant = false; // bloque avec le layout (vérification d'appartenance)

export default async function NewChannelPage({ params }: PageProps<"/w/[workspaceSlug]/channels/new">) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMembership(workspaceSlug, "editor");

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Link href={`/w/${workspace.slug}/channels`} className="text-sm text-muted-foreground hover:text-foreground">
        ← Presets de chaîne
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Nouveau preset</h1>
      <p className="mt-1 mb-8 text-muted-foreground">Seuls le nom, la niche et la langue sont obligatoires.</p>
      <ChannelForm workspaceSlug={workspace.slug} />
    </main>
  );
}
