// Formats partagés, appliqués dans la langue de l'interface (`useFormatter`, `getFormatter`).

// Prix en euros : sans centimes quand le montant est rond (19 € / €19), avec sinon (14,90 € / €14.90).
export const PRICE = { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 } as const;

// Dates : fuseau explicite, pour que le rendu serveur et l'hydratation produisent le même texte.
export const DATE = { dateStyle: "medium", timeZone: "Europe/Paris" } as const;
export const DATE_TIME = { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" } as const;
export const SHORT_DATE_TIME = { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" } as const;

// Coûts LLM d'un pipeline, souvent sous le centime : jusqu'à 4 décimales (0,0312 €).
export const COST = { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4 } as const;
export const PERCENT = { style: "percent", maximumFractionDigits: 0 } as const;
