import { describe, expect, it, vi } from "vitest";
import { createBroadcastPublisher } from "@/lib/supabase/broadcast";

function fakeAdmin(result: { success: true } | { success: false; status: number; error: string }) {
  const channel = { httpSend: vi.fn(async () => result) };
  const admin = { channel: vi.fn(() => channel), removeChannel: vi.fn(async () => "ok") };
  return { admin, channel };
}

describe("createBroadcastPublisher", () => {
  it("envoie l'événement en REST sur le canal privé du pipeline, puis libère le canal", async () => {
    const { admin, channel } = fakeAdmin({ success: true });
    await createBroadcastPublisher(admin as never, "p1")({ type: "asset.started", asset: "script" });

    expect(admin.channel).toHaveBeenCalledWith("pipeline:p1", { config: { private: true } });
    expect(channel.httpSend).toHaveBeenCalledWith("pipeline", { type: "asset.started", asset: "script" });
    expect(admin.removeChannel).toHaveBeenCalledWith(channel);
  });

  it("signale un envoi refusé, et libère quand même le canal", async () => {
    const { admin } = fakeAdmin({ success: false, status: 403, error: "RLS" });
    await expect(createBroadcastPublisher(admin as never, "p1")({ type: "pipeline.status", status: "running" })).rejects.toThrow(
      "Broadcast refusé (403) : RLS",
    );
    expect(admin.removeChannel).toHaveBeenCalled();
  });
});
