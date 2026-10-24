import { describe, expect, it } from "vitest";
import { getAnthropic } from "@/lib/ai/client";

describe("getAnthropic", () => {
  it("réutilise une seule instance", () => {
    expect(getAnthropic()).toBe(getAnthropic());
  });

  it("limite les retries du SDK pour ne pas les cumuler avec ceux d'Inngest", () => {
    expect(getAnthropic().maxRetries).toBe(2);
  });
});
