// Statuts de `pipelines.status`, partagés par le serveur et le navigateur (événements Realtime).
// `canceled` est posé par la Server Action qui annule le pipeline.
export const PIPELINE_STATUSES = ["queued", "running", "completed", "partial", "failed", "canceled"] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];
