import { describe, expect, it } from "vitest";
import { isStalled, STALLED_AFTER_MS } from "@/lib/pipeline/stalled";

const now = Date.parse("2026-10-28T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("isStalled", () => {
  it("prend la dernière activité : création, ou dernière prise ou prolongation du bail", () => {
    expect(isStalled({ created_at: ago(STALLED_AFTER_MS + 1000), started_at: null }, now)).toBe(true);
    expect(isStalled({ created_at: ago(STALLED_AFTER_MS - 1000), started_at: null }, now)).toBe(false);
    // Vidéo lancée il y a 2 h, bail repoussé il y a 2 min : toujours en cours.
    expect(isStalled({ created_at: ago(2 * 3600_000), started_at: ago(120_000) }, now)).toBe(false);
  });
});
