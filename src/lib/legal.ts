// Identité de l'éditeur, reprise par les pages légales (tâche 5.2). Les champs à `null` restent à
// renseigner par le porteur du projet : la page affiche alors « [à compléter : …] » et un bandeau
// « document provisoire ». Les textes eux-mêmes sont dans messages/*.json (namespace Legal), rédigés
// pour une société québécoise (Loi sur la protection du consommateur, Loi 25) : les faits qui
// dépendent de la langue (forme juridique, droit applicable, régions, durées) y figurent aussi.

export type LegalEntity = {
  publisher: string | null; // dénomination de la société
  address: string | null; // siège
  registration: string | null; // numéro d'entreprise du Québec (NEQ)
  taxNumbers: string | null; // numéros de TPS et de TVQ
  phone: string | null; // téléphone, exigé pour un contrat conclu à distance (LPC, art. 54.4)
  privacyOfficer: string | null; // responsable de la protection des renseignements personnels (Loi 25)
  email: string | null; // contact, y compris pour les renseignements personnels
};

export const LEGAL_ENTITY: LegalEntity = {
  publisher: "DISTRIBUTION ECONOMART INC.",
  // i18n-ignore : adresse postale, identique dans les deux langues.
  address: "914, rue Desaulniers, porte 11, Saint-Jean-sur-Richelieu (Québec) J3A 1B1",
  registration: "1180053242",
  taxNumbers: "720037357 RT0001, 1231926913 TQ0001",
  phone: null,
  privacyOfficer: "Ange Kennedy Keloute",
  email: "kelouteange@gmail.com",
};

// Hébergeur de l'application (Vercel), mentionné dans les mentions légales.
export const HOST = "Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, USA";

export const LEGAL_PAGES = ["terms", "privacy", "usage", "notice"] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];

export const LEGAL_PATHS: Record<LegalPage, string> = {
  terms: "/cgu",
  privacy: "/confidentialite",
  usage: "/charte",
  notice: "/mentions-legales",
};

export const isLegalComplete = (entity: LegalEntity = LEGAL_ENTITY) => Object.values(entity).every((value) => value !== null && value.trim() !== "");
