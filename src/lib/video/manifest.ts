import { z } from "zod";

// Contenu de l'asset `video` (asset_versions.content) : le MP4 hébergé et tout ce qui a servi à le
// monter, pour l'export (images, voix off, sous-titres) et pour l'affichage.

export const VideoShotSchema = z.object({
  sceneIndex: z.number().int().min(1),
  start: z.number().min(0), // secondes depuis le début de la vidéo
  length: z.number().positive(),
  imagePath: z.string(),
  prompt: z.string(),
});

export const VideoVoiceSchema = z.object({
  sceneIndex: z.number().int().min(1),
  path: z.string(),
  start: z.number().min(0),
  duration: z.number().positive(),
});

export const VideoManifestSchema = z.object({
  url: z.url(), // MP4 1080p sur le CDN de Shotstack
  renderId: z.string(),
  durationSeconds: z.number().positive(),
  captionsPath: z.string(),
  voice: z.array(VideoVoiceSchema).min(1),
  shots: z.array(VideoShotSchema).min(1),
  sandbox: z.boolean(), // rendu du bac à sable Shotstack : filigrane, à ne pas publier
});

export type VideoShot = z.infer<typeof VideoShotSchema>;
export type VideoVoice = z.infer<typeof VideoVoiceSchema>;
export type VideoManifest = z.infer<typeof VideoManifestSchema>;

export const VIDEO_SCHEMA_VERSION = "video@1";

// Hôtes de Shotstack (CDN et sorties de rendu) : seuls relayés par la route de téléchargement.
export function isShotstackUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      (url.hostname === "shotstack.io" || url.hostname.endsWith(".shotstack.io") || /^shotstack-[a-z0-9-]+\.s3[a-z0-9.-]*\.amazonaws\.com$/.test(url.hostname))
    );
  } catch {
    return false;
  }
}
