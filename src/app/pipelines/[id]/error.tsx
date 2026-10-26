"use client";

import * as Sentry from "@sentry/nextjs";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// Next 16 : la fonction de reprise s'appelle `retry` (elle relance le rendu du segment).
export default function PipelineError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations("PipelineError");
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-6">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("text")}</p>
        <Button type="button" className="mt-4" onClick={() => retry()}>
          {t("retry")}
        </Button>
      </div>
    </main>
  );
}
