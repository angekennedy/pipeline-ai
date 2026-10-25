import { SceneSchema, type Scene } from "./schemas/script";

// Extrait au fil du stream les scènes complètes du tableau `scenes` de premier niveau.
// Incrémental : chaque caractère n'est lu qu'une fois, même sur un script de 60 minutes.
// Une scène n'est émise qu'une fois fermée et conforme à SceneSchema : l'UI n'affiche pas de
// JSON tronqué. Le contrôle complet (index consécutifs, factCheckFlags) reste celui de la fin.
export class SceneStreamParser {
  private depth = 0;
  private inString = false;
  private escaped = false;
  private expectKey = false; // prochaine chaîne de premier niveau = clé
  private capturingKey = false;
  private key = "";
  private lastKey = "";
  private inScenes = false; // dans le tableau `scenes` de premier niveau (profondeur 2)
  private element: string | null = null; // texte de la scène en cours (profondeur 3 et plus)

  push(delta: string): Scene[] {
    const scenes: Scene[] = [];
    for (const c of delta) {
      if (this.inString) {
        this.readStringChar(c);
        continue;
      }
      if (c === "{" && this.inScenes && this.depth === 2) this.element = "";
      if (this.element !== null) this.element += c;

      switch (c) {
        case '"':
          this.inString = true;
          if (this.depth === 1 && this.expectKey) {
            this.capturingKey = true;
            this.key = "";
          }
          break;
        case "{":
          this.depth++;
          if (this.depth === 1) this.expectKey = true;
          break;
        case "[":
          this.depth++;
          if (this.depth === 2 && this.lastKey === "scenes") this.inScenes = true;
          break;
        case "}":
          if (this.inScenes && this.depth === 3 && this.element !== null) {
            const scene = parseScene(this.element);
            if (scene) scenes.push(scene);
            this.element = null;
          }
          this.depth--;
          break;
        case "]":
          this.depth--;
          if (this.inScenes && this.depth === 1) this.inScenes = false;
          break;
        case ",":
          if (this.depth === 1) this.expectKey = true;
          break;
        case ":":
          if (this.depth === 1) this.expectKey = false;
          break;
      }
    }
    return scenes;
  }

  private readStringChar(c: string) {
    if (this.element !== null) this.element += c;
    if (this.escaped) {
      this.escaped = false;
    } else if (c === "\\") {
      this.escaped = true;
    } else if (c === '"') {
      this.inString = false;
      if (this.capturingKey) {
        this.capturingKey = false;
        this.lastKey = this.key;
      }
      return;
    }
    if (this.capturingKey) this.key += c;
  }
}

function parseScene(text: string): Scene | null {
  try {
    const result = SceneSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
