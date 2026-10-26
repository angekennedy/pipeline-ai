"use client";

import { useActionState, useState } from "react";
import { deleteAccountAction, renameWorkspace, updateProfile, type SettingsState } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Feedback({ state, saved }: { state: SettingsState; saved: string }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.error}
      </p>
    );
  }
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {state.saved ? saved : ""}
    </p>
  );
}

export function ProfileForm({ displayName }: { displayName: string }) {
  const [state, action, pending] = useActionState(updateProfile, {});
  return (
    <form action={action} className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="displayName">Nom affiché</Label>
        <Input id="displayName" name="displayName" defaultValue={displayName} required maxLength={80} />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending}>
          Enregistrer
        </Button>
        <Feedback state={state} saved="Profil enregistré." />
      </div>
    </form>
  );
}

export function WorkspaceNameForm({ slug, name }: { slug: string; name: string }) {
  const [state, action, pending] = useActionState(renameWorkspace, {});
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="workspaceSlug" value={slug} />
      <div className="grid gap-1.5">
        <Label htmlFor="workspaceName">Nom du workspace</Label>
        <Input id="workspaceName" name="workspaceName" defaultValue={name} required maxLength={80} />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending}>
          Renommer
        </Button>
        <Feedback state={state} saved="Workspace renommé." />
      </div>
    </form>
  );
}

// Le bouton ne s'active qu'une fois l'adresse e-mail retapée ; la Server Action la revérifie.
export function DeleteAccountForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(deleteAccountAction, {});
  const [confirmation, setConfirmation] = useState("");
  const confirmed = confirmation.trim().toLowerCase() === email.toLowerCase();
  return (
    <form action={action} className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="confirmation">Pour confirmer, saisissez votre adresse e-mail : {email}</Label>
        <Input
          id="confirmation"
          name="confirmation"
          type="email"
          autoComplete="off"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="destructive" className="w-fit" disabled={!confirmed || pending}>
        {pending ? "Suppression…" : "Supprimer définitivement mon compte"}
      </Button>
    </form>
  );
}
