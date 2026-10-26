import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { ASSET_TYPES, type AssetType, type Brief, type Script } from "@/lib/ai/schemas";
import { generateAsset } from "@/lib/pipeline/generate-asset";
import { staleAssetsOf } from "@/lib/pipeline/staleness";
import { AssetValidationError, VersionNotFoundError, editAsset, restoreVersion } from "@/lib/pipeline/versions";
import { anthropicSequence, jsonReplyStream } from "../../mocks/anthropic";
import { MemoryPipelineStore } from "../../mocks/memory-store";
import { server } from "../../mocks/server";
import { validBrief, validScript, validSeo, validThumbnails, validTitles, validVoiceover } from "../../fixtures/assets";

const client = new Anthropic({ apiKey: "test-key", maxRetries: 0 });
const PIPELINE_ID = "7d0e6f4a-3c1b-4e8a-9f2d-5b6c7a8e9f01";
const USER_ID = "user-1";

let store: MemoryPipelineStore;
let ids: Record<AssetType, string>;

// Pipeline terminé et à jour : chaque dérivé a été produit à partir des versions courantes.
beforeEach(() => {
  store = new MemoryPipelineStore();
  store.addPipeline({ id: PIPELINE_ID, workspaceId: "ws-1", brief: validBrief as Brief, channel: null, tier: "standard" });
  const script = store.seedVersion(PIPELINE_ID, "script", validScript);
  const titles = store.seedVersion(PIPELINE_ID, "titles", validTitles, { sourceVersions: { script } });
  ids = {
    script,
    titles,
    seo: store.seedVersion(PIPELINE_ID, "seo", validSeo, { sourceVersions: { script } }),
    voiceover: store.seedVersion(PIPELINE_ID, "voiceover", validVoiceover, { sourceVersions: { script } }),
    thumbnails: store.seedVersion(PIPELINE_ID, "thumbnails", validThumbnails, { sourceVersions: { script, titles } }),
  };
});

const current = async () => Object.fromEntries(await Promise.all(ASSET_TYPES.map(async (t) => [t, (await store.getCurrentVersion(PIPELINE_ID, t))?.id])));
const regenerate = (type: AssetType, key: string, feedback?: string) =>
  generateAsset(PIPELINE_ID, type, { store, client, regeneration: { key, feedback } });

describe("régénération", () => {
  it("régénérer les titres ne touche à aucun autre asset ; seules les miniatures deviennent obsolètes", async () => {
    const titles = { ...validTitles, recommendedIndex: 2 };
    mock(() => jsonReplyStream(titles, { model: "claude-haiku-5-5" }));
    const before = await current();
    const versionId = await regenerate("titles", "regen:n1");

    const after = await current();
    expect(after.titles).toBe(versionId);
    for (const type of ["script", "seo", "voiceover", "thumbnails"] as const) expect(after[type]).toBe(before[type]);
    expect(await store.listVersions(PIPELINE_ID, "titles")).toMatchObject([{ version: 2, source: "ai_regen" }, { version: 1 }]);
    expect(await staleAssetsOf(store, PIPELINE_ID)).toEqual(["thumbnails"]);
  });

  it("régénérer le script rend obsolètes tous les dérivés, sans les régénérer", async () => {
    mock(() => jsonReplyStream(validScript));
    await regenerate("script", "regen:n2");
    expect(await staleAssetsOf(store, PIPELINE_ID)).toEqual(["titles", "seo", "voiceover", "thumbnails"]);
    expect(store.versions.filter((v) => v.assetType !== "script")).toHaveLength(4);
  });

  it("un dérivé régénéré après le script redevient à jour", async () => {
    mock(
      () => jsonReplyStream(validScript),
      () => jsonReplyStream(validSeo, { model: "claude-haiku-5-5" }),
    );
    const script = await regenerate("script", "regen:n3");
    await regenerate("seo", "regen:n4");

    expect((await store.getCurrentVersion(PIPELINE_ID, "seo"))!.sourceVersions).toEqual({ script });
    expect(await staleAssetsOf(store, PIPELINE_ID)).toEqual(["titles", "voiceover", "thumbnails"]);
  });

  it("transmet la consigne de l'utilisateur au modèle comme donnée, et la garde sur la génération", async () => {
    const calls = mock(() => jsonReplyStream(validTitles, { model: "claude-haiku-5-5" }));
    await regenerate("titles", "regen:n5", "Plus courts, sans point d'interrogation");

    expect(JSON.stringify(calls[0]!.body.messages)).toContain("<user_feedback>\\nPlus courts, sans point d'interrogation\\n</user_feedback>");
    expect(store.generation("regen:n5").userFeedback).toBe("Plus courts, sans point d'interrogation");
  });

  it("une même demande de régénération rejouée n'appelle le modèle qu'une fois", async () => {
    const calls = mock(() => jsonReplyStream(validTitles, { model: "claude-haiku-5-5" }));
    const first = await regenerate("titles", "regen:n6");
    expect(await regenerate("titles", "regen:n6")).toBe(first);
    expect(calls).toHaveLength(1);
  });
});

describe("editAsset", () => {
  it("éditer le script crée une version user_edit gratuite, recalcule les durées et rend les dérivés obsolètes", async () => {
    const edited = structuredClone(validScript) as Script;
    edited.scenes[0]!.narration = "Une narration réécrite à la main, plus courte que l'originale.";
    edited.scenes[0]!.estimatedSeconds = 999;
    const versionId = await editAsset(PIPELINE_ID, "script", edited, { store, userId: USER_ID });

    const version = store.versions.find((v) => v.id === versionId)!;
    expect(version).toMatchObject({ version: 2, source: "user_edit", generationId: null, createdBy: USER_ID });
    expect((version.content as Script).scenes[0]!.estimatedSeconds).toBe(4); // 10 mots à 150 mots/min
    expect(store.generations.size).toBe(0); // aucun appel au modèle, aucun crédit
    expect(await staleAssetsOf(store, PIPELINE_ID)).toEqual(["titles", "seo", "voiceover", "thumbnails"]);
  });

  it("éditer un dérivé l'aligne sur les versions courantes de ses dépendances", async () => {
    const script = await editAsset(PIPELINE_ID, "script", validScript, { store, userId: USER_ID });
    await editAsset(PIPELINE_ID, "titles", validTitles, { store, userId: USER_ID });
    expect((await store.getCurrentVersion(PIPELINE_ID, "titles"))!.sourceVersions).toEqual({ script });
    expect(await staleAssetsOf(store, PIPELINE_ID)).not.toContain("titles");
  });

  it("refuse un contenu invalide avec les erreurs du schéma, sans créer de version", async () => {
    const invalid = { ...validScript, scenes: validScript.scenes.slice(0, 2) }; // 3 scènes minimum
    const error = await editAsset(PIPELINE_ID, "script", invalid, { store, userId: USER_ID }).catch((e) => e);
    expect(error).toBeInstanceOf(AssetValidationError);
    expect(error).toMatchObject({ code: "SCHEMA_INVALID", issues: [expect.objectContaining({ path: ["scenes"] })] });
    expect(await store.listVersions(PIPELINE_ID, "script")).toHaveLength(1);
  });

  it("applique aussi les règles qui dépendent du pipeline (voix off : un segment par scène)", async () => {
    await expect(editAsset(PIPELINE_ID, "voiceover", validVoiceover, { store, userId: USER_ID })).rejects.toBeInstanceOf(AssetValidationError);
  });
});

describe("restoreVersion", () => {
  it("restaure une ancienne version en créant une copie, et les dérivés produits à partir d'elle redeviennent à jour", async () => {
    await editAsset(PIPELINE_ID, "script", { ...validScript, workingTitle: "Titre modifié" }, { store, userId: USER_ID });
    expect(await staleAssetsOf(store, PIPELINE_ID)).toHaveLength(4);

    const restored = await restoreVersion(PIPELINE_ID, "script", ids.script, { store, userId: USER_ID });
    const versions = await store.listVersions(PIPELINE_ID, "script");
    expect(versions.map((v) => [v.version, v.source])).toEqual([
      [3, "restore"],
      [2, "user_edit"],
      [1, "ai"],
    ]);
    expect(versions[0]).toMatchObject({ id: restored, restoredFrom: ids.script, content: versions[2]!.content });
    expect(await staleAssetsOf(store, PIPELINE_ID)).toEqual([]);
  });

  it("restaurer la version courante ne crée rien", async () => {
    expect(await restoreVersion(PIPELINE_ID, "titles", ids.titles, { store, userId: USER_ID })).toBe(ids.titles);
    expect(await store.listVersions(PIPELINE_ID, "titles")).toHaveLength(1);
  });

  it("refuse une version d'un autre asset ou d'un autre pipeline", async () => {
    await expect(restoreVersion(PIPELINE_ID, "titles", ids.script, { store, userId: USER_ID })).rejects.toBeInstanceOf(VersionNotFoundError);
    await expect(restoreVersion("autre-pipeline", "script", ids.script, { store, userId: USER_ID })).rejects.toBeInstanceOf(VersionNotFoundError);
    await expect(restoreVersion(PIPELINE_ID, "script", "inconnue", { store, userId: USER_ID })).rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
  });
});

function mock(...replies: Array<() => Response>) {
  const sequence = anthropicSequence(...replies);
  server.use(sequence.handler);
  return sequence.calls;
}
