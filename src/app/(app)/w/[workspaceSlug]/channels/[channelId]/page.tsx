import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ChannelForm } from "@/components/channels/channel-form";
import { Button } from "@/components/ui/button";
import { presetToFormValues } from "@/lib/channels/form";
import { getChannel } from "@/lib/channels/store";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/workspaces/access";
import { removeChannel } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("channel") };
}
export const instant = false; // 404 réel pour un preset d'un autre workspace

export default async function ChannelPage({ params }: PageProps<"/w/[workspaceSlug]/channels/[channelId]">) {
  const { workspaceSlug, channelId } = await params;
  if (!z.uuid().safeParse(channelId).success) notFound();
  const { workspace } = await requireMembership(workspaceSlug, "editor");
  const channel = await getChannel(await createClient(), workspace.id, channelId);
  if (!channel) notFound();
  const t = await getTranslations("Channels");

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Link href={`/w/${workspace.slug}/channels`} className="text-sm text-muted-foreground hover:text-foreground">
        {t("back")}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{channel.preset.name}</h1>
      <p className="mt-1 mb-8 text-muted-foreground">{t("editIntro")}</p>
      <ChannelForm workspaceSlug={workspace.slug} channelId={channel.id} initialValues={presetToFormValues(channel.preset)} />

      <form action={removeChannel} className="mt-10 grid gap-3 rounded-xl border border-destructive/40 p-4">
        <input type="hidden" name="workspaceSlug" value={workspace.slug} />
        <input type="hidden" name="channelId" value={channel.id} />
        <h2 className="font-medium">{t("deleteTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("deleteText")}</p>
        <Button type="submit" variant="destructive" className="w-fit">
          {t("delete")}
        </Button>
      </form>
    </main>
  );
}
