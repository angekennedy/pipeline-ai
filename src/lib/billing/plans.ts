// Catalogue des plans et des packs (ARCHITECTURE §5.1). Les allocations de crédits viennent de la
// documentation. Les prix sont provisoires : la grille et la devise restent à trancher
// (PLAN §8, question 1).
// Chaque offre payante a une clé de recherche (lookup key) Stripe : le seed (scripts/stripe-seed.mts)
// crée le prix qui la porte, et la synchronisation retrouve l'offre par elle. Changer un prix crée un
// nouveau prix Stripe qui reprend la clé.
// Sans import : le seed lit ce fichier directement avec Node.

export const PLAN_KEYS = ["free", "creator", "pro", "studio"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export type Plan = {
  key: PlanKey;
  name: string;
  credits: number;
  renewal: "once" | "monthly"; // Free : crédits offerts une seule fois
  priceEurCents: number; // par mois, 0 pour Free
  maxDurationMinutes: number;
  premium: boolean; // script rédigé par Claude Opus
  channelPresets: number;
  seats: number;
  lookupKey: string | null; // prix mensuel Stripe, null pour Free
};

export const PLANS: Record<PlanKey, Plan> = {
  free: {
    key: "free",
    name: "Free",
    credits: 30,
    renewal: "once",
    priceEurCents: 0,
    maxDurationMinutes: 10,
    premium: false,
    channelPresets: 1,
    seats: 1,
    lookupKey: null,
  },
  creator: {
    key: "creator",
    name: "Creator",
    credits: 400,
    renewal: "monthly",
    priceEurCents: 1900,
    maxDurationMinutes: 60,
    premium: false,
    channelPresets: 3,
    seats: 1,
    lookupKey: "plan_creator_monthly",
  },
  pro: {
    key: "pro",
    name: "Pro",
    credits: 1500,
    renewal: "monthly",
    priceEurCents: 4900,
    maxDurationMinutes: 60,
    premium: false,
    channelPresets: 10,
    seats: 1,
    lookupKey: "plan_pro_monthly",
  },
  studio: {
    key: "studio",
    name: "Studio",
    credits: 5000,
    renewal: "monthly",
    priceEurCents: 14900,
    maxDurationMinutes: 60,
    premium: true,
    channelPresets: 50,
    seats: 5,
    lookupKey: "plan_studio_monthly",
  },
};

// Packs ponctuels, sans expiration.
export const CREDIT_PACKS = [
  { credits: 200, priceEurCents: 1500, lookupKey: "pack_200" },
  { credits: 1000, priceEurCents: 5900, lookupKey: "pack_1000" },
] as const;

export type CatalogItem = { type: "plan"; plan: Plan; lookupKey: string } | { type: "pack"; credits: number; lookupKey: string };

// Offre désignée par la clé de recherche d'un prix Stripe ; null pour un prix inconnu du catalogue.
export function itemForLookupKey(lookupKey: string | null | undefined): CatalogItem | null {
  if (!lookupKey) return null;
  const plan = PLAN_KEYS.map((key) => PLANS[key]).find((p) => p.lookupKey === lookupKey);
  if (plan) return { type: "plan", plan, lookupKey };
  const pack = CREDIT_PACKS.find((p) => p.lookupKey === lookupKey);
  return pack ? { type: "pack", credits: pack.credits, lookupKey } : null;
}

export const isPlanKey = (value: string): value is PlanKey => (PLAN_KEYS as readonly string[]).includes(value);

// Prix et crédits s'affichent dans la langue de l'interface : `PRICE` (src/i18n/format.ts) et le
// message Common.credits.
