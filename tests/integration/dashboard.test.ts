import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listPipelines, loadBriefValues, PAGE_SIZE } from "@/lib/pipeline/list";
import { validBrief } from "../fixtures/assets";
import { admin, cleanup, createUser, unwrap, type TestUser } from "./helpers";

// Tableau de bord (tâche 2.4) : liste paginée et recherche, lues avec le client de l'utilisateur,
// et brief repris pour la duplication. B ne voit rien du workspace de A.

let a: TestUser;
let b: TestUser;
let wsA: string;
let wsB: string;
const ids: string[] = []; // du plus ancien au plus récent

const TOPICS = [
  ...Array.from({ length: PAGE_SIZE + 2 }, (_, i) => `Les pyramides, épisode ${i + 1}`),
  "100% vrai : les records de vitesse",
  "1000 ans d'histoire des moulins",
  "Le mot_clé caché des cartographes",
];

async function personal(user: TestUser) {
  return unwrap(await admin.from("workspace_members").select("workspace_id").eq("user_id", user.id).single()).workspace_id;
}

beforeAll(async () => {
  [a, b] = await Promise.all([createUser("dash-a"), createUser("dash-b")]);
  [wsA, wsB] = await Promise.all([personal(a), personal(b)]);
  const start = Date.parse("2026-10-01T08:00:00Z");
  const rows = TOPICS.map((topic, i) => ({
    workspace_id: wsA,
    created_by: a.id,
    brief: { ...validBrief, topic },
    model_tier: i === 0 ? "premium" : "standard",
    status: "completed" as const,
    idempotency_key: randomUUID(),
    created_at: new Date(start + i * 60_000).toISOString(),
  }));
  ids.push(...unwrap(await admin.from("pipelines").insert(rows).select("id, created_at")).toSorted((x, y) => x.created_at.localeCompare(y.created_at)).map((row) => row.id));
});
afterAll(cleanup);

describe("liste des pipelines", () => {
  it("donne les plus récents d'abord, par pages de PAGE_SIZE", async () => {
    const first = await listPipelines(a.client, wsA, { q: "", page: 1 });
    expect(first).toMatchObject({ total: TOPICS.length, page: 1, pageCount: 2 });
    expect(first.items.map((item) => item.id)).toEqual(ids.toReversed().slice(0, PAGE_SIZE));
    expect(first.items[0]).toEqual({
      id: ids.at(-1),
      title: TOPICS.at(-1),
      status: "completed",
      niche: validBrief.niche,
      durationMinutes: validBrief.durationMinutes,
      tier: "standard",
      createdAt: expect.any(String),
    });

    const second = await listPipelines(a.client, wsA, { q: "", page: 2 });
    expect(second.items.map((item) => item.id)).toEqual(ids.toReversed().slice(PAGE_SIZE));
    expect(second.items.at(-1)).toMatchObject({ title: TOPICS[0], tier: "premium" });
  });

  it("donne une page vide avec le total au-delà de la dernière page", async () => {
    expect(await listPipelines(a.client, wsA, { q: "", page: 9 })).toEqual({ items: [], total: TOPICS.length, page: 9, pageCount: 2 });
  });

  it("cherche dans le sujet, sans tenir compte de la casse", async () => {
    const result = await listPipelines(a.client, wsA, { q: "PYRAMIDES", page: 1 });
    expect(result).toMatchObject({ total: PAGE_SIZE + 2, pageCount: 2 });
    expect(result.items.every((item) => item.title.startsWith("Les pyramides"))).toBe(true);
    expect((await listPipelines(a.client, wsA, { q: "moulins", page: 1 })).items.map((item) => item.title)).toEqual([TOPICS.at(-2)]);
  });

  it("cherche les jokers % et _ comme des caractères", async () => {
    expect((await listPipelines(a.client, wsA, { q: "100%", page: 1 })).items.map((item) => item.title)).toEqual([TOPICS[PAGE_SIZE + 2]]);
    expect((await listPipelines(a.client, wsA, { q: "mot_clé", page: 1 })).items.map((item) => item.title)).toEqual([TOPICS.at(-1)]);
    expect((await listPipelines(a.client, wsA, { q: "s_", page: 1 })).total).toBe(0); // « s » suivi de n'importe quel caractère sinon
  });

  it("ne montre rien du workspace de A à B, et un workspace vide à son membre", async () => {
    expect(await listPipelines(b.client, wsA, { q: "", page: 1 })).toEqual({ items: [], total: 0, page: 1, pageCount: 1 });
    expect(await listPipelines(b.client, wsB, { q: "", page: 1 })).toEqual({ items: [], total: 0, page: 1, pageCount: 1 });
  });
});

describe("duplication d'un brief", () => {
  it("reprend le brief et la formule d'un pipeline du workspace", async () => {
    expect(await loadBriefValues(a.client, wsA, ids[0]!)).toEqual({
      title: TOPICS[0],
      values: {
        niche: validBrief.niche,
        topic: TOPICS[0],
        language: validBrief.language,
        tone: validBrief.tone,
        style: validBrief.style,
        durationMinutes: String(validBrief.durationMinutes),
        targetAudience: "",
        extraNotes: "",
        tier: "premium",
        channelId: "",
      },
    });
  });

  it("ne donne rien à B, ni hors du workspace ciblé", async () => {
    expect(await loadBriefValues(b.client, wsA, ids[0]!)).toBeNull();
    expect(await loadBriefValues(b.client, wsB, ids[0]!)).toBeNull();
    expect(await loadBriefValues(a.client, wsB, ids[0]!)).toBeNull();
    expect(await loadBriefValues(a.client, wsA, randomUUID())).toBeNull();
  });
});
