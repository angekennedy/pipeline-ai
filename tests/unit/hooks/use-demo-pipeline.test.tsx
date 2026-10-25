// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDemoPipeline } from "@/hooks/use-demo-pipeline";
import { demoPipeline } from "@/lib/demo/pipelines";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const running = demoPipeline("demo-running")!;
if (!running.replay) throw new Error("demo-running doit rejouer la génération");

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("useDemoPipeline", () => {
  it("part du pipeline vide en file d'attente", () => {
    const { result } = renderHook(() => useDemoPipeline(running.view, running.final));
    expect(result.current.view.status).toBe("queued");
    expect(result.current.scenes).toEqual([]);
  });

  it("affiche la première scène en moins de 10 s, avant la fin du script", () => {
    const { result } = renderHook(() => useDemoPipeline(running.view, running.final));
    advance(2000);
    expect(result.current.scenes).toHaveLength(1);
    expect(result.current.view.assets.script.status).toBe("running");
  });

  it("révèle chaque asset terminé et finit sur l'état final", () => {
    const { result } = renderHook(() => useDemoPipeline(running.view, running.final));
    advance(60_000);
    expect(result.current.view.status).toBe("completed");
    expect(result.current.view.assets).toEqual(running.final.assets);
  });

  it("arrête la démo au démontage", () => {
    const { unmount } = renderHook(() => useDemoPipeline(running.view, running.final));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
