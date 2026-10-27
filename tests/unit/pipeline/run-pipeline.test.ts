import { describe, expect, it } from "vitest";
import type { AssetType, Brief } from "@/lib/ai/schemas";
import { runPipelineSteps, type StepRunner } from "@/lib/pipeline/run-pipeline";
import type { PipelineEvent } from "@/lib/realtime/events";
import { MemoryPipelineStore } from "../../mocks/memory-store";
import { validBrief } from "../../fixtures/assets";

const PIPELINE_ID = "pipe-1";

// Exécuteur d'étapes minimal : comme Inngest, une étape qui échoue (retries épuisés) rejette.
function fakeStep() {
  const ids: string[] = [];
  const step: StepRunner = {
    run: async (id, fn) => {
      ids.push(id);
      return fn();
    },
  };
  return { step, ids };
}

function setup(failing: AssetType[] = []) {
  const store = new MemoryPipelineStore();
  store.addPipeline({ id: PIPELINE_ID, workspaceId: "ws-1", brief: validBrief as Brief, channel: null, tier: "standard" });
  const { step, ids } = fakeStep();
  const generated: AssetType[] = [];
  const generate = async (type: AssetType) => {
    generated.push(type);
    if (failing.includes(type)) throw new Error(`${type} : échec simulé`);
    return `v-${type}`;
  };
  return { store, step, ids, generated, run: () => runPipelineSteps(PIPELINE_ID, { step, store, generate }) };
}

describe("runPipelineSteps", () => {
  it("génère les cinq assets par étapes et termine en completed", async () => {
    const { run, ids, store } = setup();
    const outcome = await run();

    expect(outcome.status).toBe("completed");
    expect(outcome.assets.thumbnails).toEqual({ status: "succeeded", versionId: "v-thumbnails" });
    expect(ids).toEqual(["mark-running", "script", "titles", "seo", "voiceover", "thumbnails", "finalize"]);
    expect(store.statuses).toEqual([
      ["pipe-1", "running"],
      ["pipe-1", "completed"],
    ]);
  });

  it("un échec du SEO donne partial avec les quatre autres assets présents", async () => {
    const { run, store } = setup(["seo"]);
    const outcome = await run();

    expect(outcome.status).toBe("partial");
    expect(outcome.assets.seo).toEqual({ status: "failed", error: "seo : échec simulé" });
    for (const type of ["script", "titles", "voiceover", "thumbnails"] as const) {
      expect(outcome.assets[type].status).toBe("succeeded");
    }
    expect(store.statuses.at(-1)).toEqual(["pipe-1", "partial"]);
  });

  it("un échec du script ne lance aucun dérivé et termine en failed", async () => {
    const { run, generated, ids, store } = setup(["script"]);
    const outcome = await run();

    expect(outcome.status).toBe("failed");
    expect(generated).toEqual(["script"]);
    expect(ids).toEqual(["mark-running", "script", "finalize"]);
    for (const type of ["titles", "seo", "voiceover", "thumbnails"] as const) {
      expect(outcome.assets[type]).toEqual({ status: "skipped" });
    }
    expect(store.statuses.at(-1)).toEqual(["pipe-1", "failed"]);
  });

  it("un échec des titres saute les miniatures, mais pas le SEO ni la voix off", async () => {
    const { run, generated } = setup(["titles"]);
    const outcome = await run();

    expect(outcome.status).toBe("partial");
    expect(outcome.assets.thumbnails).toEqual({ status: "skipped" });
    expect(generated).toEqual(["script", "titles", "seo", "voiceover"]);
  });

  it("lance en parallèle les assets d'une même étape", async () => {
    const { store } = setup();
    let running = 0;
    let maxRunning = 0;
    const generate = async (type: AssetType) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return `v-${type}`;
    };
    await runPipelineSteps(PIPELINE_ID, { step: fakeStep().step, store, generate });
    expect(maxRunning).toBe(3); // titles, seo, voiceover
  });

  it("publie le statut du pipeline au démarrage et à la fin", async () => {
    const { store, step } = setup(["seo"]);
    const events: PipelineEvent[] = [];
    await runPipelineSteps(PIPELINE_ID, {
      step,
      store,
      generate: async (type) => {
        if (type === "seo") throw new Error("échec");
        return `v-${type}`;
      },
      publish: async (event) => void events.push(event),
    });
    expect(events).toEqual([
      { type: "pipeline.status", status: "running" },
      { type: "pipeline.status", status: "partial" },
    ]);
  });

  describe("vidéo", () => {
    const withVideo = (requested: boolean, failing: AssetType[] = []) => {
      const ctx = setup(failing);
      ctx.store.addPipeline({ id: PIPELINE_ID, workspaceId: "ws-1", brief: { ...validBrief, video: requested } as Brief, channel: null, tier: "standard" });
      return ctx;
    };

    it("tourne après les miniatures quand le brief la demande, et compte dans le statut", async () => {
      const { store, step, ids, generated } = withVideo(true);
      const calls: string[] = [];
      const outcome = await runPipelineSteps(PIPELINE_ID, { step, store, generate: async (type) => (generated.push(type), `v-${type}`), video: async () => (calls.push("video"), "v-video") });
      expect(outcome).toMatchObject({ status: "completed", video: { status: "succeeded", versionId: "v-video" } });
      expect(ids.slice(-3)).toEqual(["thumbnails", "video:requested", "finalize"]);
      expect(calls).toEqual(["video"]);
    });

    it("un échec de la vidéo donne partial, les assets texte restent", async () => {
      const { store, step } = withVideo(true);
      const outcome = await runPipelineSteps(PIPELINE_ID, {
        step,
        store,
        generate: async (type) => `v-${type}`,
        video: async () => {
          throw new Error("rendu en échec");
        },
      });
      expect(outcome).toMatchObject({ status: "partial", video: { status: "failed", error: "rendu en échec" } });
      expect(outcome.assets.script.status).toBe("succeeded");
    });

    it("ne la lance pas quand le brief ne la demande pas", async () => {
      const { store, step } = withVideo(false);
      let called = false;
      const outcome = await runPipelineSteps(PIPELINE_ID, { step, store, generate: async (type) => `v-${type}`, video: async () => ((called = true), "v") });
      expect(called).toBe(false);
      expect(outcome).toMatchObject({ status: "completed" });
      expect(outcome).not.toHaveProperty("video");
    });

    it("ne la lance pas quand le script a échoué", async () => {
      const { store, step } = withVideo(true);
      let called = false;
      const outcome = await runPipelineSteps(PIPELINE_ID, {
        step,
        store,
        generate: async (type) => {
          if (type === "script") throw new Error("script refusé");
          return `v-${type}`;
        },
        video: async () => ((called = true), "v"),
      });
      expect(called).toBe(false);
      expect(outcome.status).toBe("failed");
    });
  });
});
