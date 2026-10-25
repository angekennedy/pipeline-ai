-- 0005 realtime : canaux Broadcast privés `pipeline:<uuid>` (src/lib/realtime/events.ts). Seuls les
-- membres du workspace du pipeline peuvent s'y abonner ; l'envoi se fait en service role (httpSend).
create policy rt_pipeline_read on realtime.messages for select to authenticated using (
  realtime.topic() ~ '^pipeline:[0-9a-f-]{36}$'
  and exists (
    select 1 from public.pipelines p
    where p.id = substring(realtime.topic() from 10)::uuid and private.has_role(p.workspace_id)
  )
);
