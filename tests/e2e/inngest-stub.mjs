// Bouchon de l'API d'événements Inngest pour les e2e : accepte les envois comme le serveur de dev
// (POST /e/<clé>) sans déclencher de fonction, donc sans appel au modèle. GET /events renvoie les
// événements reçus, pour vérifier qu'un pipeline a bien été lancé.
import { createServer } from "node:http";

const port = Number(process.env.INNGEST_STUB_PORT ?? 8288);
const events = [];

createServer((req, res) => {
  const json = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "POST" && req.url?.startsWith("/e/")) {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const received = [JSON.parse(raw)].flat();
      events.push(...received);
      json(200, { ids: received.map((event) => event.id ?? `evt-${events.length}`), status: 200 });
    });
    return;
  }
  if (req.method === "GET" && req.url === "/events") return json(200, events);
  if (req.method === "GET" && req.url === "/health") return json(200, { ok: true });
  json(404, { error: "not found" });
}).listen(port, "127.0.0.1");
