import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsId, eventUuid, isNewAccount, track } from "@/lib/analytics/posthog";

// Funnel PostHog (tâche 5.3) : aucun appel réseau, `fetch` simulé.
const NOW = new Date("2026-10-26T12:00:00.000Z");
const ok = () => vi.fn(async () => new Response(null, { status: 200 }));

afterEach(() => vi.restoreAllMocks());

describe("track", () => {
  it("envoie l'événement à l'API de capture, sans donnée personnelle", async () => {
    const fetch = ok();
    await track("user-1", { name: "pipeline_created", properties: { tier: "standard", minutes: 8 } }, "pipe-1", { key: "phc_test", host: "https://eu.i.posthog.com", fetch, now: () => NOW });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://eu.i.posthog.com/i/v0/e/");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      api_key: "phc_test",
      event: "pipeline_created",
      distinct_id: analyticsId("user-1"),
      uuid: eventUuid("pipeline_created:pipe-1"),
      timestamp: "2026-10-26T12:00:00.000Z",
      properties: { tier: "standard", minutes: 8, $process_person_profile: false, $geoip_disable: true },
    });
    expect(init.body).not.toContain("user-1"); // l'id n'apparaît qu'en empreinte
  });

  it("n'envoie rien sans clé PostHog", async () => {
    const fetch = ok();
    await track("user-1", { name: "signed_up", properties: { method: "email" } }, "user-1", { key: undefined, fetch });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ne bloque jamais le parcours : réponse refusée ou réseau en panne seulement journalisés", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const event = { name: "signed_up", properties: { method: "google" } } as const;
    await expect(track("u", event, "u", { key: "phc_test", fetch: vi.fn(async () => new Response(null, { status: 401 })) })).resolves.toBeUndefined();
    await expect(track("u", event, "u", { key: "phc_test", fetch: vi.fn(async () => Promise.reject(new Error("ECONNRESET"))) })).resolves.toBeUndefined();
    expect(warn.mock.calls.map((call) => call[0])).toEqual(["PostHog : signed_up refusé (401)", "PostHog : signed_up non envoyé"]);
  });
});

describe("identifiants", () => {
  it("donne une empreinte stable et non réversible de l'utilisateur", () => {
    expect(analyticsId("user-1")).toBe(analyticsId("user-1"));
    expect(analyticsId("user-1")).toMatch(/^[0-9a-f]{32}$/);
    expect(analyticsId("user-1")).not.toBe(analyticsId("user-2"));
  });

  it("dérive un UUID stable de chaque fait, pour que PostHog dédoublonne un rejeu", () => {
    expect(eventUuid("payment_completed:cs_1")).toBe(eventUuid("payment_completed:cs_1"));
    expect(eventUuid("payment_completed:cs_1")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(eventUuid("payment_completed:cs_1")).not.toBe(eventUuid("payment_completed:cs_2"));
  });

  it("ne voit une inscription que dans le premier quart d'heure du compte", () => {
    expect(isNewAccount("2026-10-26T11:50:00.000Z", NOW)).toBe(true);
    expect(isNewAccount("2026-10-26T11:40:00.000Z", NOW)).toBe(false);
    expect(isNewAccount(undefined, NOW)).toBe(false);
  });
});
