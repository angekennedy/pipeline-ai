import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Médias des pipelines dans Supabase Storage (bucket privé `pipeline-media`, migration 0017) :
// images des miniatures et des plans, voix off, sous-titres. Le premier segment du chemin est le
// workspace : la policy de lecture le compare aux appartenances de l'utilisateur. Le MP4 final reste
// hébergé par Shotstack (au-delà des 50 Mo par fichier du plan Free de Supabase).

export const MEDIA_BUCKET = "pipeline-media";

export type MediaStorage = {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  download(path: string): Promise<Uint8Array>;
  // Lien temporaire, pour Shotstack (le temps du rendu) ou pour le navigateur.
  signedUrl(path: string, expiresInSeconds: number): Promise<string>;
};

// `<workspace>/<pipeline>/<segments…>` : chaque segment est un identifiant ou un nom de fichier
// produit par le code, jamais un texte de l'utilisateur.
export function mediaPath(workspaceId: string, pipelineId: string, ...segments: string[]): string {
  for (const segment of [workspaceId, pipelineId, ...segments]) {
    if (!/^[A-Za-z0-9._-]+$/.test(segment) || segment.startsWith(".")) throw new Error(`Segment de chemin invalide : ${segment}`);
  }
  return [workspaceId, pipelineId, ...segments].join("/");
}

export function supabaseMediaStorage(db: SupabaseClient<Database>): MediaStorage {
  const bucket = () => db.storage.from(MEDIA_BUCKET);
  return {
    async upload(path, bytes, contentType) {
      // upsert : une étape rejouée après un échec réécrit le même fichier au lieu d'échouer.
      const { error } = await bucket().upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`Envoi du média ${path} : ${error.message}`);
    },
    async download(path) {
      const { data, error } = await bucket().download(path);
      if (error) throw new Error(`Lecture du média ${path} : ${error.message}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async signedUrl(path, expiresInSeconds) {
      const { data, error } = await bucket().createSignedUrl(path, expiresInSeconds);
      if (error) throw new Error(`Lien du média ${path} : ${error.message}`);
      return data.signedUrl;
    },
  };
}
