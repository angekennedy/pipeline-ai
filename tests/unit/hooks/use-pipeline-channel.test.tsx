// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePipelineChannel } from "@/hooks/use-pipeline-channel";
import { validScript } from "../../fixtures/assets";

const refresh = vi.fn();
// Instance stable, comme le routeur de l'App Router.
const router = { refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

type BroadcastHandler = (message: { payload: unknown }) => void;
type StatusHandler = (status: string) => void;

// Client Supabase réduit à ce que le hook utilise : channel().on().subscribe() et removeChannel().
function fakeClient() {
  let onBroadcast: BroadcastHandler = () => {};
  let onStatus: StatusHandler = () => {};
  const channel = {
    on: vi.fn((_type: string, _filter: unknown, handler: BroadcastHandler) => {
      onBroadcast = handler;
      return channel;
    }),
    subscribe: vi.fn((handler: StatusHandler) => {
      onStatus = handler;
      return channel;
    }),
  };
  const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(async () => "ok") };
  return {
    client,
    channel,
    emit: (payload: unknown) => act(() => onBroadcast({ payload })),
    status: (status: string) => act(() => onStatus(status)),
  };
}

const PIPELINE_ID = "7d0e6f4a-3c1b-4e8a-9f2d-5b6c7a8e9f01";

function setup(initialStatus: "queued" | "running" = "running") {
  const fake = fakeClient();
  const hook = renderHook(() => usePipelineChannel(PIPELINE_ID, { initialStatus, client: fake.client as never }));
  return { ...fake, hook };
}

beforeEach(() => {
  refresh.mockClear();
});

describe("usePipelineChannel", () => {
  it("s'abonne au canal privé du pipeline, sur l'événement du pipeline", () => {
    const { client, channel } = setup();
    expect(client.channel).toHaveBeenCalledWith(`pipeline:${PIPELINE_ID}`, { config: { private: true } });
    expect(channel.on).toHaveBeenCalledWith("broadcast", { event: "pipeline" }, expect.any(Function));
  });

  it("part du statut lu en base", () => {
    const { hook } = setup("queued");
    expect(hook.result.current).toMatchObject({ status: "queued", scenes: [], assets: {}, connected: false });
  });

  it("affiche les scènes reçues au fil du stream, sans relire la page", () => {
    const { emit, hook } = setup();
    emit({ type: "asset.started", asset: "script" });
    emit({ type: "asset.partial", asset: "script", scenes: validScript.scenes.slice(0, 2) });
    emit({ type: "asset.partial", asset: "script", scenes: validScript.scenes.slice(2) });

    expect(hook.result.current.scenes.map((s) => s.index)).toEqual([1, 2, 3, 4]);
    expect(hook.result.current.assets.script).toBe("running");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("relit la page quand un asset est terminé ou que le statut du pipeline change", () => {
    const { emit, hook } = setup();
    emit({ type: "asset.completed", asset: "script", versionId: "v1" });
    emit({ type: "pipeline.status", status: "completed" });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(hook.result.current).toMatchObject({ status: "completed", assets: { script: "ready" } });
  });

  it("garde un seul abonnement quand l'état change", () => {
    const { emit, client } = setup();
    emit({ type: "asset.started", asset: "script" });
    emit({ type: "asset.completed", asset: "script", versionId: "v1" });
    expect(client.channel).toHaveBeenCalledTimes(1);
    expect(client.removeChannel).not.toHaveBeenCalled();
  });

  it("ignore un message qui ne respecte pas le schéma", () => {
    const { emit, hook } = setup();
    emit({ type: "asset.partial", asset: "script", scenes: [{ index: "un" }] });
    emit("texte libre");
    expect(hook.result.current.scenes).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("relit la page à chaque (re)connexion : aucun événement manqué n'a d'effet durable", () => {
    const { status, hook } = setup();
    status("SUBSCRIBED");
    expect(hook.result.current.connected).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1); // comble l'intervalle entre le rendu serveur et l'abonnement

    status("CHANNEL_ERROR");
    expect(hook.result.current.connected).toBe(false);
    status("SUBSCRIBED");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("se désabonne au démontage", () => {
    const { client, channel, hook } = setup();
    hook.unmount();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });
});
