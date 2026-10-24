import { ASSET_TYPES, type AssetType } from "@/lib/ai/schemas";
import { registry } from "./registry";

type Graph = Partial<Record<AssetType, { dependsOn: readonly AssetType[] }>>;

// Étapes d'exécution : chaque asset part dès que ses dépendances sont prêtes, et les assets d'une
// même étape tournent en parallèle. L'ordre dans une étape suit celui du graphe.
export function buildStages(graph: Graph): AssetType[][] {
  const types = Object.keys(graph) as AssetType[];
  for (const type of types) {
    for (const dep of graph[type]!.dependsOn) {
      if (!(dep in graph)) throw new Error(`Dépendance inconnue : ${type} dépend de ${dep}`);
    }
  }

  const stages: AssetType[][] = [];
  const done = new Set<AssetType>();
  while (done.size < types.length) {
    const ready = types.filter((type) => !done.has(type) && graph[type]!.dependsOn.every((dep) => done.has(dep)));
    if (ready.length === 0) {
      throw new Error(`Cycle de dépendances entre : ${types.filter((type) => !done.has(type)).join(", ")}`);
    }
    stages.push(ready);
    ready.forEach((type) => done.add(type));
  }
  return stages;
}

export const PIPELINE_STAGES = buildStages(registry);

// Assets à marquer obsolètes quand `type` change de version, dépendances indirectes comprises.
export function dependentsOf(type: AssetType): AssetType[] {
  const stale = new Set<AssetType>([type]);
  // ASSET_TYPES est dans l'ordre du DAG : une dépendance précède toujours ses dépendants.
  for (const candidate of ASSET_TYPES) {
    if (registry[candidate].dependsOn.some((dep) => stale.has(dep))) stale.add(candidate);
  }
  stale.delete(type);
  return [...stale];
}
