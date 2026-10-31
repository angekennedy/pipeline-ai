import { OpenAIError } from "@/lib/ai/openai";

// Refus de la modération d'OpenAI sur une image (`moderation_blocked`, 400) : le prompt est jugé
// contraire à ses règles (violence, par exemple), souvent à cause du sujet, même historique. Relancer
// la même requête ne changerait rien.
export function isModerationBlocked(error: unknown): boolean {
  return error instanceof OpenAIError && error.status === 400 && (error.code === "moderation_blocked" || /safety system/i.test(error.message));
}

// Image d'un plan de la vidéo refusée, même avec le prompt adouci : l'utilisateur modifie la scène
// (direction visuelle) puis relance. Le message porte `[scene:N]`, que la page lit pour nommer la scène ;
// le détail du fournisseur reste pour le diagnostic (/admin).
export class ImageRefusedError extends Error {
  readonly code = "IMAGE_REFUSED";
  readonly retryable = false;

  constructor(
    readonly sceneIndex: number,
    cause: unknown,
  ) {
    // i18n-ignore : message de diagnostic (/admin), jamais affiché tel quel.
    super(`[scene:${sceneIndex}] Image refusée par la modération d'OpenAI, même adoucie : ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ImageRefusedError";
  }
}

export const refusedSceneOf = (message: string | null) => {
  const match = message?.match(/\[scene:(\d+)\]/);
  return match ? Number(match[1]) : undefined;
};
