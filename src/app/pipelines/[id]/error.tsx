"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// Next 16 : la fonction de reprise s'appelle `retry` (elle relance le rendu du segment).
export default function PipelineError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-6">
        <h1 className="text-lg font-semibold">Impossible d&apos;afficher ce pipeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">Une erreur est survenue pendant le chargement. Vos assets ne sont pas perdus.</p>
        <Button type="button" className="mt-4" onClick={() => retry()}>
          Réessayer
        </Button>
      </div>
    </main>
  );
}
