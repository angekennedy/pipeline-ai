import { creditSummary } from "@/lib/billing/balance";

// Solde du mode démo, en attendant l'authentification et les workspaces (phase 2) : un compte Free
// qui vient de recevoir ses 30 crédits. Un pipeline Premium de 10 min (35 crédits) le dépasse.
export const DEMO_CREDITS = creditSummary("free", 30);
