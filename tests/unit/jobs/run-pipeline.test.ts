import Anthropic from "@anthropic-ai/sdk";
import { InngestTestEngine } from "@inngest/test";
import { HttpResponse, http } from "msw/http";
import { beforeEach, describe, expect, it } from "vitest";
import { ASSET_TYPES, type Brief, type ChannelPreset } from "@/lib/ai/schemas";
import { createRunPipelineFunction, markPipelineFailed } from "@/lib/jobs/functions/run-pipeline";
import { ANTHROPIC_MESSAGES_URL, jsonReplyStream, refusalStream } from "../../mocks/anthropic";
import { MemoryPipelineStore } from "../../mocks/memory-store";
import { server } from "../../mocks/server";
import { validBrief, validChannel, validScript, validSeo, validThumbnails, validTitles, validVoiceover } from "../../fixtures/assets";

const PIPELINE_ID = "7d0e6f4a-3c1b-4e8a-9f2d-5b6c7a8e9f01";
const WORKSPACE_ID = "1f2e3d4c-5b6a-4987-8a1b-2c3d4e5f6a7b";
const client = new Anthropic({ apiKey: "test-key", maxRetries: 0 });

const voiceover = { ...validVoiceover, segments: [1, 2, 3, 4].map((sceneIndex) => ({ ...validVoiceover.segments[0]!, sceneIndex })) };

// Réponses par asset, reconnu au rôle annoncé dans le prompt système : les dérivés partent en parallèle,
// l'ordre des requêtes n'est pas fixe.
const ROLES = [
  ["scriptwriter", "script"],
  ["packaging strategist", "titles"],
  ["SEO specialist", "seo"],
  ["voice director", "voiceover"],
  ["thumbnail art director", "thumbnails"],
] as const;

type Asset = (typeof ROLES)[number][1];

function mockAssets(overrides: Partial<Record<Asset, () => Response>> = {}) {
  const replies: Record<Asset, () => Response> = {
    script: () => jsonReplyStream(validScript),
    titles: () => jsonReplyStream(validTitles, { model: "claude-haiku-5-5" }),
    seo: () => jsonReplyStream(validSeo, { model: "claude-haiku-5-5" }),
    voiceover: () => jsonReplyStream(voiceover, { model: "claude-haiku-5-5" }),
    thumbnails: () => jsonReplyStream(validThumbnails, { model: "claude-haiku-5-5" }),
    ...overrides,
  };
  const requested: Asset[] = [];
  server.use(
    http.post(ANTHROPIC_MESSAGES_URL, async ({ request }) => {
      const body = (await request.json()) as { system: Array<{ text: string }> };
      const asset = ROLES.find(([role]) => body.system[0]!.text.includes(role))![1];
      requested.push(asset);
      return replies[asset]();
    }),
  );
  return requested;
}

let store: MemoryPipelineStore;

const createFn = () => createRunPipelineFunction({ store: () => store, anthropic: client });

const engine = (data: Record<string, unknown> = { pipelineId: PIPELINE_ID, workspaceId: WORKSPACE_ID }) =>
  new InngestTestEngine({ function: createFn(), events: [{ name: "pipeline/requested", data }] });

const presentAssets = async () => {
  const versions = await Promise.all(ASSET_TYPES.map((type) => store.getCurrentVersion(PIPELINE_ID, type)));
  return ASSET_TYPES.filter((_, i) => versions[i] !== null);
};

beforeEach(() => {
  store = new MemoryPipelineStore();
  store.addPipeline({
    id: PIPELINE_ID,
    workspaceId: WORKSPACE_ID,
    brief: validBrief as Brief,
    channel: validChannel as ChannelPreset,
    tier: "standard",
  });
});

// Le moteur de test d'Inngest arrête l'exécution au premier échec définitif d'une étape, alors
// qu'Inngest renvoie l'erreur à la fonction : les statuts partial et failed sont couverts par
// tests/unit/pipeline/run-pipeline.test.ts. Après des étapes parallèles, il poursuit aussi dans
// plusieurs branches : on vérifie l'état final, pas le nombre d'appels.
describe("fonction Inngest run-pipeline", () => {
  it("génère les cinq assets et termine en completed", async () => {
    mockAssets();
    const { result } = await engine().execute();

    expect(result).toMatchObject({ status: "completed" });
    expect(await presentAssets()).toEqual(["script", "titles", "seo", "voiceover", "thumbnails"]);
    expect(store.statuses[0]).toEqual([PIPELINE_ID, "running"]);
    expect(store.statuses.at(-1)).toEqual([PIPELINE_ID, "completed"]);
  });

  it("transforme un refus en erreur non relançable, après l'avoir enregistré", async () => {
    const requested = mockAssets({ script: () => refusalStream("cyber") });
    const { error } = await engine().execute();

    expect(error).toMatchObject({ name: "NonRetriableError", message: expect.stringContaining("refusée") });
    expect(requested).toEqual(["script"]);
    expect(store.generation(`pipe:${PIPELINE_ID}:script`).failure).toMatchObject({ code: "CONTENT_REFUSED" });
  });

  it("laisse une erreur transitoire de l'API relançable par Inngest", async () => {
    mockAssets({
      script: () => HttpResponse.json({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, { status: 529 }),
    });
    const { error } = await engine().execute();

    expect(error).toBeDefined();
    expect((error as Error).name).not.toBe("NonRetriableError");
    expect(store.generation(`pipe:${PIPELINE_ID}:script`).failure).toMatchObject({ code: "PROVIDER_ERROR" });
  });

  it("déclare l'idempotence par pipeline, la concurrence par workspace et l'annulation", () => {
    expect(createFn().opts).toMatchObject({
      id: "run-pipeline",
      idempotency: "event.data.pipelineId",
      concurrency: [{ key: "event.data.workspaceId", limit: 2 }, { limit: 50 }],
      retries: 3,
      cancelOn: [{ event: "pipeline/canceled", match: "data.pipelineId" }],
    });
  });

  it("rejette un événement dont l'identifiant de pipeline n'est pas un UUID", async () => {
    mockAssets();
    const { error } = await engine({ pipelineId: "pas-un-uuid", workspaceId: WORKSPACE_ID }).execute();
    expect(error).toBeDefined();
    expect(store.statuses).toEqual([]);
  });

  it("passe le pipeline en failed quand la fonction échoue après ses retries", async () => {
    await markPipelineFailed(() => store)({ event: { data: { event: { data: { pipelineId: PIPELINE_ID } } } } });
    expect(store.statuses).toEqual([[PIPELINE_ID, "failed"]]);
  });
});
