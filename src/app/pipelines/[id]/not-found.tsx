import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function PipelineNotFound() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 text-center">
      <h1 className="text-xl font-semibold">Pipeline introuvable</h1>
      <p className="mt-1 text-muted-foreground">Ce pipeline n&apos;existe pas, ou vous n&apos;y avez pas accès.</p>
      <Link href="/pipelines/new" className={buttonVariants({ className: "mt-6" })}>
        Créer un pipeline
      </Link>
    </main>
  );
}
