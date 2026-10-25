import { creditSummary } from "@/lib/billing/balance";

// Solde du mode démo, en attendant l'authentification et les workspaces (phase 2) : un compte Free
// qui a déjà utilisé 10 de ses 30 crédits. Un pipeline de 8 min (18 crédits) passe, un de 10 min
// (21 crédits) ouvre le modal « crédits insuffisants », et au-delà de 10 min le plan refuse.
export const DEMO_CREDITS = creditSummary("free", 20);
