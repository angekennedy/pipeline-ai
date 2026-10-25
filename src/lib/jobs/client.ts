import { Inngest } from "inngest";

// Mode cloud par défaut : clé de signature requise en production (INNGEST_SIGNING_KEY).
// En local, `INNGEST_DEV=1` pointe vers le serveur de dev (`npx inngest-cli dev`).
export const inngest = new Inngest({ id: "pipeline-ai" });
