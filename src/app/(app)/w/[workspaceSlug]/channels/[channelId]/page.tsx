import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ChannelForm } from "@/components/channels/channel-form";
import { Button } from "@/components/ui/button";
import { presetToFormValues } from "@/lib/channels/form";
import { getChannel } from "@/lib/channels/store";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/workspaces/access";
import { removeChannel } from "../actions";

export const metadata: Metadata = { title: "Preset de chaîne · Pipeline AI" };
export const instant = false; // 404 réel pour un preset d'un autre workspace

export default async function ChannelPage({ params }: PageProps<"/w/[workspaceSlug]/channels/[channelId]">) {
  const { workspaceSlug, channelId } = await params;
  if (!z.uuid().safeParse(channelId).success) notFound();
  const { workspace } = await requireMembership(workspaceSlug, "editor");
  const channel = await getChannel(await createClient(), workspace.id, channelId);
  if (!channel) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Link href={`/w/${workspace.slug}/channels`} className="text-sm text-muted-foreground hover:text-foreground">
        ← Presets de chaîne
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{channel.preset.name}</h1>
      <p className="mt-1 mb-8 text-muted-foreground">Les pipelines déjà créés gardent la version du preset utilisée à leur lancement.</p>
      <ChannelForm workspaceSlug={workspace.slug} channelId={channel.id} initialValues={presetToFormValues(channel.preset)} />

      <form action={removeChannel} className="mt-10 grid gap-3 rounded-xl border border-destructive/40 p-4">
        <input type="hidden" name="workspaceSlug" value={workspace.slug} />
        <input type="hidden" name="channelId" value={channel.id} />
        <h2 className="font-medium">Supprimer ce preset</h2>
        <p className="text-sm text-muted-foreground">Les pipelines créés avec lui restent intacts, avec leur copie du preset.</p>
        <Button type="submit" variant="destructive" className="w-fit">
          Supprimer le preset
        </Button>
      </form>
    </main>
  );
}
