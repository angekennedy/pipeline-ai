import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DeleteAccountForm, ProfileForm, WorkspaceNameForm } from "@/components/settings/settings-forms";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasRole } from "@/lib/workspaces/access";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("settings") };
}
export const instant = false; // lit la session avant tout rendu

export default async function SettingsPage() {
  const user = await requireUser("/settings");
  const [t, labels] = await Promise.all([getTranslations("Settings"), getTranslations("Labels.role")]);
  const db = await createClient();
  const [{ data: profile, error: profileError }, { data: memberships, error: membershipsError }] = await Promise.all([
    db.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    db.from("workspace_members").select("role, workspaces(id, slug, name, created_at)").eq("user_id", user.id),
  ]);
  if (profileError) throw new Error(`Profil de ${user.id} : ${profileError.message}`);
  if (membershipsError) throw new Error(`Workspaces de ${user.id} : ${membershipsError.message}`);

  const workspaces = memberships
    .flatMap(({ role, workspaces: workspace }) => (workspace ? [{ role, ...workspace }] : []))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const owned = workspaces.filter((workspace) => workspace.role === "owner");

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-10 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      <section aria-labelledby="profile" className="grid gap-4">
        <h2 id="profile" className="text-lg font-semibold">
          {t("profile")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("email", { email: user.email ?? "" })}</p>
        <ProfileForm displayName={profile?.display_name ?? ""} />
      </section>

      <section aria-labelledby="workspaces" className="grid gap-4">
        <h2 id="workspaces" className="text-lg font-semibold">
          {t("workspaces")}
        </h2>
        {workspaces.map((workspace) => (
          <div key={workspace.id} className="grid gap-3 rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">
              {workspace.name} · {labels(workspace.role)}
            </p>
            {hasRole(workspace.role, "admin") && <WorkspaceNameForm slug={workspace.slug} name={workspace.name} />}
          </div>
        ))}
      </section>

      <section aria-labelledby="danger" className="grid gap-4 rounded-xl border border-destructive/40 p-4">
        <h2 id="danger" className="text-lg font-semibold">
          {t("deleteTitle")}
        </h2>
        <div className="grid gap-2 text-sm">
          <p>{t("deleteIntro")}</p>
          <ul className="list-disc pl-5">
            <li>{t("deleteProfile")}</li>
            {owned.map((workspace) => (
              <li key={workspace.id}>{t("deleteWorkspace", { name: workspace.name })}</li>
            ))}
            <li>{t("deleteSubscription")}</li>
          </ul>
          <p className="text-muted-foreground">{t("deleteCopyFirst")}</p>
        </div>
        {user.email && <DeleteAccountForm email={user.email} />}
      </section>
    </main>
  );
}
