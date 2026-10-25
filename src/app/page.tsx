import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

const DEMOS = [
  { id: "demo-running", label: "Génération en direct", description: "Les scènes du script s'affichent au fil de l'écriture." },
  { id: "demo-completed", label: "Pipeline terminé", description: "Les cinq assets, prêts à copier." },
  { id: "demo-partial", label: "Pipeline partiel", description: "Le SEO a échoué, les autres assets sont prêts." },
  { id: "demo-failed", label: "Pipeline en échec", description: "Le script a échoué : rien d'autre n'est lancé." },
  { id: "demo-stale", label: "Script modifié", description: "Le script a été retouché : les autres assets sont obsolètes." },
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-12 px-4 py-20">
      <section className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Pipeline AI</h1>
        <p className="max-w-md text-lg text-muted-foreground">
          Du brief à la vidéo faceless prête à produire : script, titres, SEO, voix off et miniatures.
        </p>
        <Link href="/pipelines/new" className={buttonVariants({ size: "lg" })}>
          Créer un pipeline
        </Link>
      </section>

      <section aria-labelledby="demos">
        <h2 id="demos" className="mb-4 text-lg font-semibold">
          Démonstrations
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {DEMOS.map((demo) => (
            <li key={demo.id}>
              <Link href={`/pipelines/${demo.id}`} className="block rounded-xl border p-4 hover:bg-muted">
                <span className="font-medium">{demo.label}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{demo.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
