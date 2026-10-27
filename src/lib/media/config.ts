import "server-only";
import { serverEnv } from "@/lib/env/server";

// Vidéo disponible : voix (ElevenLabs) et rendu (Shotstack) configurés. Sinon l'option est
// grisée dans le formulaire et refusée à la création.
export const videoAvailable = () => Boolean(serverEnv.ELEVENLABS_API_KEY && serverEnv.ELEVENLABS_VOICE_ID && serverEnv.SHOTSTACK_API_KEY);

// `stage` : bac à sable gratuit (vidéos avec filigrane), `v1` : production facturée.
export const shotstackEnv = () => serverEnv.SHOTSTACK_ENV ?? (serverEnv.VERCEL_ENV === "production" ? "v1" : "stage");
