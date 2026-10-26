// Identité de l'éditeur, reprise par les pages légales (tâche 5.2). Les champs à `null` restent à
// renseigner par le porteur du projet : la page affiche alors « [à compléter : …] » et un bandeau
// « document provisoire ». Les textes eux-mêmes sont dans messages/*.json (namespace Legal).

export type LegalEntity = {
  publisher: string | null; // raison sociale, ou nom et prénom d'un entrepreneur individuel
  legalForm: string | null; // forme juridique et capital (SAS au capital de…, EI…)
  address: string | null; // siège social
  registration: string | null; // RCS ou SIREN, et numéro de TVA intracommunautaire
  director: string | null; // directeur de la publication
  email: string | null; // contact, y compris pour les données personnelles
  jurisdiction: string | null; // droit applicable et tribunaux compétents
  mediator: string | null; // médiateur de la consommation (obligatoire pour une vente aux consommateurs en France)
  databaseRegion: string | null; // région d'hébergement de Supabase
  errorRetention: string | null; // durée de conservation des rapports d'erreur (Sentry)
};

export const LEGAL_ENTITY: LegalEntity = {
  publisher: null,
  legalForm: null,
  address: null,
  registration: null,
  director: null,
  email: null,
  jurisdiction: null,
  mediator: null,
  databaseRegion: null,
  errorRetention: null,
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
