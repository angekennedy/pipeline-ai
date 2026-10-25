import type { Scene } from "@/lib/ai/schemas";
import { SCENE_PURPOSE_LABELS } from "@/lib/pipeline/labels";
import { formatTimestamp } from "@/lib/pipeline/postprocess/chapters";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function SceneCard({ scene, startsAt }: { scene: Scene; startsAt: number | null }) {
  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        {startsAt !== null && <span className="font-mono text-muted-foreground">{formatTimestamp(startsAt)}</span>}
        <Badge variant="secondary">{SCENE_PURPOSE_LABELS[scene.purpose]}</Badge>
        <h3 className="font-medium">
          {scene.index}. {scene.title}
        </h3>
      </div>
      <p className="leading-relaxed">{scene.narration}</p>
      <dl className="mt-3 grid gap-1 text-sm text-muted-foreground">
        <div>
          <dt className="inline font-medium text-foreground">Visuel : </dt>
          <dd className="inline">{scene.visualDirection}</dd>
        </div>
        {scene.onScreenText && (
          <div>
            <dt className="inline font-medium text-foreground">Texte à l&apos;écran : </dt>
            <dd className="inline">{scene.onScreenText}</dd>
          </div>
        )}
        {scene.bRollKeywords.length > 0 && (
          <div>
            <dt className="inline font-medium text-foreground">B-roll : </dt>
            <dd className="inline">{scene.bRollKeywords.join(", ")}</dd>
          </div>
        )}
      </dl>
    </li>
  );
}

// Début de chaque scène, cumulé depuis 0.
function sceneStarts(scenes: Scene[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const scene of scenes) {
    starts.push(at);
    at += scene.estimatedSeconds;
  }
  return starts;
}

// Scènes du script. Pendant la génération, les durées ne sont pas encore recalculées : pas
// d'horodatage, et un emplacement signale la scène en cours d'écriture.
export function SceneStream({ scenes, streaming }: { scenes: Scene[]; streaming: boolean }) {
  const starts = sceneStarts(scenes);
  return (
    <div>
      <ol className="grid gap-3" aria-label="Scènes du script" aria-live={streaming ? "polite" : undefined}>
        {scenes.map((scene, i) => (
          <SceneCard key={scene.index} scene={scene} startsAt={streaming ? null : starts[i]!} />
        ))}
      </ol>
      {streaming && (
        <div className="mt-3 rounded-xl border border-dashed p-4" role="status">
          <span className="sr-only">Écriture de la scène {scenes.length + 1}…</span>
          <Skeleton className="mb-2 h-4 w-1/3" />
          <Skeleton className="mb-1 h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      )}
    </div>
  );
}
