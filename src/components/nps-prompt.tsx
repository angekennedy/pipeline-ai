"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { dismissNps, submitNps, type NpsState } from "@/app/(app)/nps-actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SCORES = Array.from({ length: 11 }, (_, score) => score);

// Question NPS de la bêta (tâche 5.6), posée dans le tableau de bord après le deuxième pipeline abouti.
export function NpsPrompt() {
  const t = useTranslations("Nps");
  const [state, action, pending] = useActionState<NpsState, FormData>(submitNps, {});

  if (state.sent) {
    return (
      <p role="status" className="mb-6 rounded-xl border bg-muted/50 p-4 text-sm">
        {t("thanks")}
      </p>
    );
  }
  return (
    <section aria-labelledby="nps-title" className="mb-6 grid gap-3 rounded-xl border p-4">
      <h2 id="nps-title" className="font-medium">
        {t("title")}
      </h2>
      <form action={action} className="grid gap-3">
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm">{t("question")}</legend>
          <div className="flex flex-wrap gap-1">
            {SCORES.map((score) => (
              <label key={score} className="flex min-w-9 cursor-pointer items-center justify-center rounded-md border px-2 py-1 text-sm has-checked:bg-foreground has-checked:text-background">
                <input type="radio" name="score" value={score} className="sr-only" required />
                {score}
              </label>
            ))}
          </div>
          <p className="flex justify-between text-xs text-muted-foreground">
            <span>{t("low")}</span>
            <span>{t("high")}</span>
          </p>
        </fieldset>
        <div className="grid gap-1">
          <Label htmlFor="nps-comment">{t("comment")}</Label>
          <Textarea id="nps-comment" name="comment" maxLength={1000} rows={2} />
        </div>
        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {t("scoreError")}
          </p>
        )}
        <Button type="submit" size="sm" disabled={pending} className="w-fit">
          {pending ? t("sending") : t("send")}
        </Button>
      </form>
      {/* Formulaire à part : « plus tard » n'a pas à exiger une note. */}
      <form action={dismissNps}>
        <Button type="submit" size="sm" variant="ghost">
          {t("later")}
        </Button>
      </form>
    </section>
  );
}
