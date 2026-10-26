"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { BROADCAST_EVENT, PipelineEventSchema, pipelineTopic } from "@/lib/realtime/events";
import { applyPipelineEvent, initialLiveState, refreshesPage } from "@/lib/realtime/pipeline-state";
import type { PipelineStatus } from "@/lib/pipeline/status";

type Options = {
  initialStatus?: PipelineStatus | null; // statut lu en base par la page serveur
  client?: SupabaseClient; // injecté par les tests ; référence stable attendue
};

// Suit en direct un pipeline sur son canal privé (RLS sur realtime.messages). La base reste la source
// de vérité : la page est relue à chaque étape terminée et à chaque (re)connexion, y compris la
// première, qui couvre les événements émis entre le rendu serveur et l'abonnement.
export function usePipelineChannel(pipelineId: string, { initialStatus = null, client }: Options = {}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(applyPipelineEvent, initialStatus, initialLiveState);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const supabase = client ?? createClient();
    const channel = supabase
      .channel(pipelineTopic(pipelineId), { config: { private: true } })
      .on("broadcast", { event: BROADCAST_EVENT }, ({ payload }) => {
        const parsed = PipelineEventSchema.safeParse(payload);
        if (!parsed.success) return;
        dispatch(parsed.data);
        if (refreshesPage(parsed.data)) router.refresh();
      })
      .subscribe((status) => {
        const isSubscribed = status === "SUBSCRIBED";
        setConnected(isSubscribed);
        if (isSubscribed) router.refresh();
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [pipelineId, client, router]);

  return { ...state, connected };
}
