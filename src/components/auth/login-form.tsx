"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { sendMagicLink, signInWithGoogle, type MagicLinkState } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Erreurs passées dans l'URL par /auth/confirm et la connexion Google (Login.errors).
const URL_ERRORS = { lien: "expiredLink", google: "google", invite: "inviteOnly" } as const;

const initialState: MagicLinkState = { status: "idle", email: "" };

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const t = useTranslations("Login");
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const urlError = searchParams.get("error");
  const linkError = urlError && Object.hasOwn(URL_ERRORS, urlError) ? URL_ERRORS[urlError as keyof typeof URL_ERRORS] : undefined;
  const [state, formAction, pending] = useActionState(sendMagicLink, initialState);

  if (state.status === "sent") {
    return (
      <div role="status" className="rounded-xl border p-4 text-sm">
        <p className="font-medium">{t("sentTitle")}</p>
        <p className="mt-1 text-muted-foreground">{t("sentText", { email: state.email })}</p>
      </div>
    );
  }

  const error = state.status === "error" ? state.error : linkError;
  return (
    <div className="grid gap-6">
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      )}
      <form action={formAction} className="grid gap-3" noValidate>
        <input type="hidden" name="next" value={next} />
        <div className="grid gap-1.5">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? t("sending") : t("submit")}
        </Button>
      </form>
      {googleEnabled && (
        <form action={signInWithGoogle} className="grid">
          <input type="hidden" name="next" value={next} />
          <Button type="submit" variant="outline">
            {t("google")}
          </Button>
        </form>
      )}
    </div>
  );
}
