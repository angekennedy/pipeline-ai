import { z } from "zod";
import { ASSET_TYPES } from "@/lib/ai/schemas";
import { SceneSchema } from "@/lib/ai/schemas/script";
import { PIPELINE_STATUSES } from "@/lib/pipeline/status";

// Événements Realtime Broadcast d'un pipeline, sur le canal privé `pipeline:<id>`. Ils servent à
// l'affichage en direct seulement : la base reste la source de vérité, un message perdu n'a pas
// d'effet durable. Le navigateur valide chaque message avec ce schéma.

export const BROADCAST_EVENT = "pipeline";

export const pipelineTopic = (pipelineId: string) => `pipeline:${pipelineId}`;

const AssetTypeSchema = z.enum(ASSET_TYPES);

export const PipelineEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("asset.started"), asset: AssetTypeSchema }),
  // Scènes du script terminées depuis le dernier envoi, avant post-traitement (durées estimées).
  z.object({ type: z.literal("asset.partial"), asset: z.literal("script"), scenes: z.array(SceneSchema) }),
  z.object({ type: z.literal("asset.completed"), asset: AssetTypeSchema, versionId: z.string() }),
  z.object({ type: z.literal("asset.failed"), asset: AssetTypeSchema, code: z.string() }),
  z.object({ type: z.literal("pipeline.status"), status: z.enum(PIPELINE_STATUSES) }),
]);

export type PipelineEvent = z.infer<typeof PipelineEventSchema>;
export type PipelineEventPublisher = (event: PipelineEvent) => Promise<void>;
