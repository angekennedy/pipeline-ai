import { afterEach, describe, expect, it, vi } from "vitest";
import { sentryOptions } from "@/lib/observability/sentry";

describe("sentryOptions", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("désactive Sentry sans DSN", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", undefined);
    expect(sentryOptions("nodejs")).toMatchObject({ enabled: false, environment: "development" });
  });

  it("n'envoie aucune donnée personnelle et échantillonne les traces en production", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://abc@o1.ingest.sentry.io/2");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
    expect(sentryOptions("browser")).toEqual({
      dsn: "https://abc@o1.ingest.sentry.io/2",
      enabled: true,
      environment: "production",
      initialScope: { tags: { runtime: "browser" } },
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
    });
  });

  it("garde toutes les traces sur une preview", () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
    expect(sentryOptions("edge").tracesSampleRate).toBe(1);
  });
});
