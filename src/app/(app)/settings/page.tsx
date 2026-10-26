import type { Metadata } from "next";
import { DeleteAccountForm, ProfileForm, WorkspaceNameForm } from "@/components/settings/settings-forms";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasRole } from "@/lib/workspaces/access";

export const metadata: Metadata = { title: "Paramètres · Pipeline AI" };
export const instant = false; // lit la session avant tout rendu

const ROLE_LABELS = { owner: "Propriétaire", admin: "Administrateur", editor: "Éditeur", viewer: "Lecteur" } as const;

export default async function SettingsPage() {
  const user = await requireUser("/settings");
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
      <h1 className="text-2xl font-semibold tracking-tight">Paramètres</h1>

      <section aria-labelledby="profile" className="grid gap-4">
        <h2 id="profile" className="text-lg font-semibold">
          Profil
        </h2>
        <p className="text-sm text-muted-foreground">Adresse e-mail : {user.email}</p>
        <ProfileForm displayName={profile?.display_name ?? ""} />
      </section>

      <section aria-labelledby="workspaces" className="grid gap-4">
        <h2 id="workspaces" className="text-lg font-semibold">
          Workspaces
        </h2>
        {workspaces.map((workspace) => (
          <div key={workspace.id} className="grid gap-3 rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">
              {workspace.name} · {ROLE_LABELS[workspace.role]}
            </p>
            {hasRole(workspace.role, "admin") && <WorkspaceNameForm slug={workspace.slug} name={workspace.name} />}
          </div>
        ))}
      </section>

      <section aria-labelledby="danger" className="grid gap-4 rounded-xl border border-destructive/40 p-4">
        <h2 id="danger" className="text-lg font-semibold">
          Supprimer mon compte
        </h2>
        <div className="grid gap-2 text-sm">
          <p>La suppression est définitive et immédiate. Elle efface :</p>
          <ul className="list-disc pl-5">
            <li>votre profil et votre connexion ;</li>
            {owned.map((workspace) => (
              <li key={workspace.id}>
                le workspace « {workspace.name} » et tout son contenu : pipelines, scripts, versions, presets de chaîne et crédits ;
              </li>
            ))}
            <li>votre abonnement, s&apos;il y en a un : il est annulé immédiatement.</li>
          </ul>
          <p className="text-muted-foreground">Copiez d&apos;abord les assets que vous voulez garder.</p>
        </div>
        {user.email && <DeleteAccountForm email={user.email} />}
      </section>
    </main>
  );
}
