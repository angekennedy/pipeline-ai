import { describe, expect, it } from "vitest";
import { escapeLike, parseListParams, SEARCH_MAX_LENGTH } from "@/lib/pipeline/list";

describe("parseListParams", () => {
  it("lit la recherche et la page", () => {
    expect(parseListParams({ q: "  pyramides ", page: "3" })).toEqual({ q: "pyramides", page: 3 });
  });

  it("retombe sur la première page, sans recherche", () => {
    expect(parseListParams({})).toEqual({ q: "", page: 1 });
    for (const page of ["0", "-2", "1.5", "abc", "", "9999999"]) expect(parseListParams({ page }).page, page).toBe(1);
  });

  it("garde la première valeur d'un paramètre répété et borne la recherche", () => {
    expect(parseListParams({ q: ["a", "b"], page: ["2", "5"] })).toEqual({ q: "a", page: 2 });
    expect(parseListParams({ q: "x".repeat(500) }).q).toHaveLength(SEARCH_MAX_LENGTH);
  });
});

describe("escapeLike", () => {
  it("échappe les jokers et la barre oblique inverse", () => {
    expect(escapeLike(String.raw`100% mot_clé \n`)).toBe(String.raw`100\% mot\_clé \\n`);
  });
});
