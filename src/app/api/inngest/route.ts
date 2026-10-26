import { serve } from "inngest/next";
import { sweepStaleReservations } from "@/lib/billing/reservation";
import { getStripe } from "@/lib/billing/stripe";
import { stripeReader, syncStripeEvent } from "@/lib/billing/stripe-sync";
import { inngest } from "@/lib/jobs/client";
import { createRegenerateAssetFunction } from "@/lib/jobs/functions/regenerate-asset";
import { createRunPipelineFunction } from "@/lib/jobs/functions/run-pipeline";
import { createStripeSyncFunction } from "@/lib/jobs/functions/stripe-sync";
import { createSweepReservationsFunction } from "@/lib/jobs/functions/sweep-reservations";
import type { JobDeps } from "@/lib/jobs/step-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createBroadcastPublisher } from "@/lib/supabase/broadcast";
import { SupabasePipelineStore } from "@/lib/supabase/pipeline-store";

// Le script Premium en streaming dure jusqu'à 4 min : une étape doit tenir dans une invocation.
export const maxDuration = 300;

// Un client service role par instance, créé à la première requête.
let admin: ReturnType<typeof createAdminClient> | undefined;
const db = () => (admin ??= createAdminClient());

const deps: JobDeps = {
  store: () => new SupabasePipelineStore(db()),
  publisher: (pipelineId) => createBroadcastPublisher(db(), pipelineId),
};

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    createRunPipelineFunction(deps),
    createRegenerateAssetFunction(deps),
    createSweepReservationsFunction({ sweep: () => sweepStaleReservations(db()) }),
    createStripeSyncFunction({ sync: (eventId) => syncStripeEvent(eventId, { stripe: stripeReader(getStripe()), db: db() }) }),
  ],
});
