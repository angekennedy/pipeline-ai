"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { sendMagicLink, signInWithGoogle, type MagicLinkState } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ERRORS: Record<string, string> = {
  lien: "Ce lien de connexion a expiré ou a déjà servi. Demandez-en un nouveau.",
  google: "La connexion avec Google a échoué. Réessayez, ou recevez un lien par e-mail.",
};

const initialState: MagicLinkState = { status: "idle", email: "" };

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const linkError = ERRORS[searchParams.get("error") ?? ""];
  const [state, formAction, pending] = useActionState(sendMagicLink, initialState);

  if (state.status === "sent") {
    return (
      <div role="status" className="rounded-xl border p-4 text-sm">
        <p className="font-medium">Vérifiez votre boîte de réception</p>
        <p className="mt-1 text-muted-foreground">
          Un lien de connexion a été envoyé à {state.email}. Il est valable une heure et ne sert qu&apos;une fois.
        </p>
      </div>
    );
  }

  const error = state.status === "error" ? state.message : linkError;
  return (
    <div className="grid gap-6">
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <form action={formAction} className="grid gap-3" noValidate>
        <input type="hidden" name="next" value={next} />
        <div className="grid gap-1.5">
          <Label htmlFor="email">Adresse e-mail</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Envoi…" : "Recevoir un lien de connexion"}
        </Button>
      </form>
      {googleEnabled && (
        <form action={signInWithGoogle} className="grid">
          <input type="hidden" name="next" value={next} />
          <Button type="submit" variant="outline">
            Continuer avec Google
          </Button>
        </form>
      )}
    </div>
  );
}
