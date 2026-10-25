import type { Metadata } from "next";
import { Suspense } from "react";
import { BriefForm } from "@/components/pipeline/brief-form";
import { requireUser } from "@/lib/auth/session";
import { DEMO_CREDITS } from "@/lib/demo/credits";

export const metadata: Metadata = { title: "Nouveau pipeline · Pipeline AI" };

export default function NewPipelinePage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Nouveau pipeline</h1>
      <p className="mt-1 mb-8 text-muted-foreground">
        Décrivez la vidéo : le script, les titres, le SEO, la voix off et les miniatures sont générés à partir de ce brief.
      </p>
      <Suspense>
        <AuthenticatedBriefForm />
      </Suspense>
    </main>
  );
}

// Le proxy a déjà renvoyé vers /login sans session ; la page le revérifie (DAL).
async function AuthenticatedBriefForm() {
  await requireUser("/pipelines/new");
  return <BriefForm credits={DEMO_CREDITS} />;
}
