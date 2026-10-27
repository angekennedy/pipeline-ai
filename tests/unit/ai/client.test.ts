import { describe, expect, it } from "vitest";
import { getOpenAI } from "@/lib/ai/client";

describe("getOpenAI", () => {
  it("réutilise une seule instance", () => {
    expect(getOpenAI()).toBe(getOpenAI());
  });

  it("limite les relances du client pour ne pas les cumuler avec celles d'Inngest", () => {
    expect(getOpenAI().maxRetries).toBe(2);
  });
});
