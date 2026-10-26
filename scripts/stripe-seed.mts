// Produits et prix Stripe du catalogue (tâche 3.3), créés ou mis à jour sans doublon :
//   pnpm stripe:seed            # STRIPE_SECRET_KEY lue dans .env.local
// Un produit par offre, à identifiant fixe (`pipeline_<offre>`). Le prix porte la clé de recherche de
// l'offre (src/lib/billing/plans.ts) : un montant changé crée un nouveau prix, qui reprend la clé, et
// archive l'ancien. Les abonnements existants gardent leur prix jusqu'à leur modification.
import Stripe from "stripe";
import { CREDIT_PACKS, PLAN_KEYS, PLANS } from "../src/lib/billing/plans.ts";

const key = process.env.STRIPE_SECRET_KEY;
if (!key?.startsWith("sk_")) throw new Error("STRIPE_SECRET_KEY manquante (.env.local)");
if (key.startsWith("sk_live_") && process.env.STRIPE_SEED_LIVE !== "1") {
  throw new Error("Clé live : relancez avec STRIPE_SEED_LIVE=1 pour créer le catalogue en production.");
}
const stripe = new Stripe(key);

type Offer = { productId: string; name: string; lookupKey: string; amount: number; recurring: boolean; metadata: Record<string, string> };

const offers: Offer[] = [
  ...PLAN_KEYS.map((planKey) => PLANS[planKey])
    .filter((plan) => plan.lookupKey)
    .map((plan) => ({
      productId: `pipeline_plan_${plan.key}`,
      name: `Pipeline AI ${plan.name}`,
      lookupKey: plan.lookupKey!,
      amount: plan.priceEurCents,
      recurring: true,
      metadata: { plan_key: plan.key, credits: String(plan.credits) },
    })),
  ...CREDIT_PACKS.map((pack) => ({
    productId: `pipeline_pack_${pack.credits}`,
    name: `Pipeline AI : pack de ${pack.credits} crédits`,
    lookupKey: pack.lookupKey,
    amount: pack.priceEurCents,
    recurring: false,
    metadata: { pack_credits: String(pack.credits) },
  })),
];

async function ensureProduct(offer: Offer) {
  try {
    const product = await stripe.products.retrieve(offer.productId);
    if (product.name !== offer.name || !product.active) await stripe.products.update(offer.productId, { name: offer.name, active: true, metadata: offer.metadata });
  } catch (error) {
    if (!(error instanceof Stripe.errors.StripeInvalidRequestError) || error.code !== "resource_missing") throw error;
    await stripe.products.create({ id: offer.productId, name: offer.name, metadata: offer.metadata });
  }
}

for (const offer of offers) {
  await ensureProduct(offer);
  const [current] = (await stripe.prices.list({ lookup_keys: [offer.lookupKey], active: true, limit: 1 })).data;
  const same =
    current &&
    current.product === offer.productId &&
    current.unit_amount === offer.amount &&
    current.currency === "eur" &&
    (current.recurring?.interval === "month") === offer.recurring;
  if (same) {
    console.log(`${offer.lookupKey} : à jour (${current.id})`);
    continue;
  }
  const price = await stripe.prices.create({
    product: offer.productId,
    currency: "eur",
    unit_amount: offer.amount,
    ...(offer.recurring && { recurring: { interval: "month" } }),
    lookup_key: offer.lookupKey,
    transfer_lookup_key: true,
    metadata: offer.metadata,
  });
  if (current) await stripe.prices.update(current.id, { active: false });
  console.log(`${offer.lookupKey} : ${current ? "nouveau prix" : "créé"} (${price.id})`);
}
