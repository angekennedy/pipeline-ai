import { serve } from "inngest/next";
import { checkAlerts, reportAlerts } from "@/lib/admin/economics";
import { releaseRegeneration, sweepStaleReservations } from "@/lib/billing/reservation";
import { getStripe } from "@/lib/billing/stripe";
import { stripeReader, syncStripeEvent } from "@/lib/billing/stripe-sync";
import { getOpenAI } from "@/lib/ai/client";
import { imageModel } from "@/lib/ai/models";
import { serverEnv } from "@/lib/env/server";
import { inngest } from "@/lib/jobs/client";
import { shotstackEnv, videoAvailable } from "@/lib/media/config";
import { ElevenLabsClient } from "@/lib/media/elevenlabs";
import { ShotstackClient } from "@/lib/media/shotstack";
import { supabaseMediaStorage } from "@/lib/media/storage";
import { createMonitorEconomicsFunction } from "@/lib/jobs/functions/monitor-economics";
import { createRegenerateAssetFunction } from "@/lib/jobs/functions/regenerate-asset";
import { createRunPipelineFunction } from "@/lib/jobs/functions/run-pipeline";
import { createStripeSyncFunction } from "@/lib/jobs/functions/stripe-sync";
import { createSweepReservationsFunction } from "@/lib/jobs/functions/sweep-reservations";
import { purgeRateLimits } from "@/lib/security/rate-limit";
import type { JobDeps } from "@/lib/jobs/step-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createBroadcastPublisher } from "@/lib/supabase/broadcast";
import { SupabasePipelineStore } from "@/lib/supabase/pipeline-store";

// Le script Premium en streaming dure jusqu'à 4 min : une étape doit tenir dans une invocation.
export const maxDuration = 300;

// Un client service role par instance, créé à la première requête.
let admin: ReturnType<typeof createAdminClient> | undefined;
const db = () => (admin ??= createAdminClient());

const images = () => ({ openai: getOpenAI(), storage: supabaseMediaStorage(db()), model: imageModel() });

// Vidéo : null tant que la voix ou le rendu ne sont pas configurés (media/config).
const video = () => {
  if (!videoAvailable()) return null;
  const env = shotstackEnv();
  return {
    ...images(),
    store: new SupabasePipelineStore(db()),
    voice: new ElevenLabsClient(serverEnv.ELEVENLABS_API_KEY!),
    render: new ShotstackClient(serverEnv.SHOTSTACK_API_KEY!, env),
    config: { voiceId: serverEnv.ELEVENLABS_VOICE_ID!, voiceModel: serverEnv.ELEVENLABS_MODEL_ID, imageModel: imageModel(), sandbox: env === "stage" },
  };
};

const deps: JobDeps = {
  store: () => new SupabasePipelineStore(db()),
  publisher: (pipelineId) => createBroadcastPublisher(db(), pipelineId),
  releaseRegeneration: (key) => releaseRegeneration(db(), key),
  images,
  video,
};

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    createRunPipelineFunction(deps),
    createRegenerateAssetFunction(deps),
    createSweepReservationsFunction({ sweep: () => sweepStaleReservations(db()), purgeRateLimits: () => purgeRateLimits(db()) }),
    createMonitorEconomicsFunction({ check: () => checkAlerts(db()), report: reportAlerts }),
    createStripeSyncFunction({ sync: (eventId) => syncStripeEvent(eventId, { stripe: stripeReader(getStripe()), db: db() }) }),
  ],
});
