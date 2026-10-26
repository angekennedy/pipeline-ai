import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BROADCAST_EVENT, pipelineTopic, type PipelineEventPublisher } from "@/lib/realtime/events";

// Envoi côté serveur par l'API REST de Realtime : pas d'abonnement ni de WebSocket à maintenir
// depuis une fonction serverless. Le client service role passe la RLS de realtime.messages ; le
// canal est privé, seuls les membres du workspace peuvent s'y abonner.
export function createBroadcastPublisher(admin: SupabaseClient, pipelineId: string): PipelineEventPublisher {
  return async (event) => {
    const channel = admin.channel(pipelineTopic(pipelineId), { config: { private: true } });
    try {
      const result = await channel.httpSend(BROADCAST_EVENT, event);
      if (!result.success) throw new Error(`Broadcast refusé (${result.status}) : ${result.error}`);
    } finally {
      await admin.removeChannel(channel);
    }
  };
}
