import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Pipeline AI</h1>
      <p className="max-w-md text-lg text-muted-foreground">
        Du brief à la vidéo faceless prête à produire : script, titres, SEO, voix off et miniatures.
      </p>
      <Button disabled>Bientôt disponible</Button>
    </main>
  );
}
