import { describe, expect, it } from "vitest";
import { SceneStreamParser } from "@/lib/ai/partial-json";
import { validScript } from "../../fixtures/assets";

const json = JSON.stringify(validScript);
const [scene1, scene2, scene3, scene4] = validScript.scenes;

const parse = (text: string) => new SceneStreamParser().push(text);

describe("SceneStreamParser", () => {
  it("ne renvoie rien tant que le tableau des scènes n'a pas commencé", () => {
    expect(parse("")).toEqual([]);
    expect(parse(json.slice(0, json.indexOf('"scenes"')))).toEqual([]);
  });

  it("ne renvoie que les scènes complètes", () => {
    const cut = json.indexOf('"index":2') + 30; // au milieu de la scène 2
    expect(parse(json.slice(0, cut))).toEqual([scene1]);
  });

  it("renvoie toutes les scènes d'un JSON complet", () => {
    expect(parse(json)).toEqual(validScript.scenes);
  });

  it("donne le même résultat, quel que soit le découpage en deltas", () => {
    for (const size of [1, 7, 64]) {
      const parser = new SceneStreamParser();
      const scenes = [];
      for (let i = 0; i < json.length; i += size) scenes.push(...parser.push(json.slice(i, i + size)));
      expect(scenes).toEqual(validScript.scenes);
    }
  });

  it("renvoie chaque scène une seule fois au fil des deltas", () => {
    const parser = new SceneStreamParser();
    const middle = json.indexOf('"index":3');
    expect(parser.push(json.slice(0, middle))).toEqual([scene1, scene2]);
    expect(parser.push(json.slice(middle))).toEqual([scene3, scene4]);
    expect(parser.push("")).toEqual([]);
  });

  it("ignore accolades, crochets et guillemets échappés dans les chaînes", () => {
    const tricky = { ...scene1, narration: 'Il dit : "} ] { [" puis \\ se tait, avant la suite.', title: "a\"b" };
    expect(parse(JSON.stringify({ workingTitle: "x", scenes: [tricky, scene2] }))).toEqual([tricky, scene2]);
  });

  it("ne confond pas une clé \"scenes\" écrite dans une valeur ou dans un objet imbriqué", () => {
    const text = JSON.stringify({
      hookSummary: '"scenes": [{"index": 9}]',
      meta: { scenes: [scene3] },
      scenes: [scene1],
    });
    expect(parse(text)).toEqual([scene1]);
  });

  it("saute une scène qui ne respecte pas le schéma, sans bloquer les suivantes", () => {
    const broken = { ...scene2, purpose: "intro" };
    expect(parse(JSON.stringify({ scenes: [scene1, broken, scene3] }))).toEqual([scene1, scene3]);
  });

  it("supporte les espaces et sauts de ligne d'un JSON indenté", () => {
    expect(parse(JSON.stringify(validScript, null, 2))).toEqual(validScript.scenes);
  });
});
