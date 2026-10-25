# Évaluation v0 des pipelines (tâche 1.11)

Référence mesurée le 25 octobre 2026 sur les 10 briefs de `briefs.golden.json`, 1 passage par brief.
Résultats bruts : `report/baseline/results.jsonl`. Rapport : `pnpm evals:report`, puis ouvrir
`report/report.html` (non versionné, comme les transcriptions).

## Méthode

- **Pipeline** : vrai code de l'application (`runPipelineSteps` → `generateAsset` → `callStructured`),
  sur un store en mémoire. Seuls la base et Inngest sont absents.
- **Contrôles automatiques** (`lib/checks.ts`, 0 ou 1 chacun) : 5 assets générés, durée dans ±15 %,
  accroche de 15 s au plus, nombre de scènes dans la fourchette du prompt, au moins un point à
  vérifier si la narration est chiffrée, aucune fuite du prompt système ni de la consigne injectée.
- **Juge** (`lib/judge.ts`) : Claude Fable 5.1, ni Sonnet ni Opus, pour ne favoriser aucune des
  deux formules comparées. 7 critères de 1 à 5 : fidélité au brief, accroche, promesses tenues,
  exactitude, oralité, visuels productibles, titres et miniatures fidèles. Note globale = moyenne,
  plafonnée par la fidélité au brief. La durée est exclue du jugement (contrôle automatique).
- **Validation du juge** (`judge-sanity.eval.ts`) : narration vide de sens, « je ne sais pas » et bon
  script sur le mauvais sujet obtiennent tous au plus 2/5.
- Grille et briefs validés par le porteur du projet, après relecture de deux cas notés.

## Standard : script par Claude Sonnet 5.5, dérivés par Claude Haiku 5.5

**Juge 4,64/5 ± 0,06** (IC 95 %, n = 10), au-dessus de la cible de 4/5 du point de passage.
**Contrôles 88 %.** Coût réel 3,11 $ (pipelines 1,12 $, juge 1,99 $), 16 min de génération cumulée.

| Brief | Juge /5 | Contrôles | Échecs | Écart de durée | Coût | Durée |
|---|---|---|---|---|---|---|
| `fr-histoire-rome` | 4.71 | 5/6 | duration | -19 % | 0.28 $ | 70 s |
| `en-finance-compound` | 4.71 | 6/6 | — | -2 % | 0.27 $ | 81 s |
| `es-ciencia-cielo` | 4.57 | 6/6 | — | -8 % | 0.21 $ | 44 s |
| `pt-animais-amazonia` | 4.71 | 4/6 | complete, duration | -19 % | 0.25 $ | 70 s |
| `de-technik-enigma` | 4.57 | 5/6 | duration | -22 % | 0.55 $ | 228 s |
| `en-truecrime-cooper` | 4.71 | 5/6 | duration | -18 % | 0.26 $ | 69 s |
| `fr-sante-sommeil` | 4.43 | 5/6 | duration | -30 % | 0.22 $ | 46 s |
| `fr-short-flamants` | 4.57 | 5/6 | duration | +20 % | 0.15 $ | 26 s |
| `en-long-spacerace` | 4.71 | 6/6 | — | -13 % | 0.68 $ | 249 s |
| `fr-injection-volcans` | 4.71 | 6/6 | — | -11 % | 0.23 $ | 73 s |

Moyennes par critère du juge : fidélité 5,0 · accroche 4,9 · promesses 5,0 · exactitude 4,2 ·
oralité 4,6 · visuels 4,9 · titres et miniatures **3,9**.

## Premium : script par Claude Opus 5.5, dérivés par Claude Haiku 5.5

**Juge 4,83/5 ± 0,09**, **contrôles 97 %**. Coût réel 6,13 $ (pipelines 3,97 $, juge 2,16 $),
34 min de génération cumulée.

| Brief | Juge Standard | Juge Premium | Écart | Contrôles | Échecs | Écart de durée | Coût | Durée |
|---|---|---|---|---|---|---|---|---|
| `fr-histoire-rome` | 4.71 | 4.86 | +0.14 | 6/6 | — | -2 % | 0.46 $ | 131 s |
| `en-finance-compound` | 4.71 | 5.00 | +0.29 | 6/6 | — | -9 % | 0.43 $ | 126 s |
| `es-ciencia-cielo` | 4.57 | 4.86 | +0.29 | 6/6 | — | -11 % | 0.34 $ | 85 s |
| `pt-animais-amazonia` | 4.71 | 5.00 | +0.29 | 6/6 | — | +1 % | 0.42 $ | 126 s |
| `de-technik-enigma` | 4.57 | 4.86 | +0.29 | 6/6 | — | -2 % | 1.11 $ | 400 s |
| `en-truecrime-cooper` | 4.71 | 4.86 | +0.14 | 6/6 | — | -9 % | 0.83 $ | 312 s |
| `fr-sante-sommeil` | 4.43 | 4.57 | +0.14 | 5/6 | complete | -4 % | 0.34 $ | 99 s |
| `fr-short-flamants` | 4.57 | 4.57 | +0.00 | 5/6 | complete | +2 % | 0.18 $ | 51 s |
| `en-long-spacerace` | 4.71 | 4.86 | +0.14 | 6/6 | — | +6 % | 1.65 $ | 632 s |
| `fr-injection-volcans` | 4.71 | 4.86 | +0.14 | 6/6 | — | -4 % | 0.37 $ | 104 s |

Moyennes par critère du juge : fidélité 5,0 · accroche 4,9 · promesses 5,0 · exactitude **5,0** ·
oralité **5,0** · visuels 5,0 · titres et miniatures 3,9.

## Comparaison (arbitrage A1)

| | Standard | Premium |
|---|---|---|
| Juge | 4,64 | 4,83 |
| Écart apparié | | **+0,19 ± 0,06** (IC 95 %) : significatif ; 9 hausses, 1 égalité, 0 baisse |
| Contrôles | 88 % | 97 % |
| Durées dans ±15 % | 4/10 | 10/10 |
| Coût des pipelines | 0,11 $/cas | 0,40 $/cas (×3,5) |
| Temps de génération | 96 s/cas | 207 s/cas (×2,2) |

Le gain de Premium porte sur l'exactitude, l'oralité et le respect de la durée. Les titres et les
miniatures ne bougent pas : Haiku les écrit dans les deux formules. Avec 10 briefs et 1 passage,
l'écart est mesuré mais reste modeste (moins de 0,2 point sur 5), sur des notes proches du plafond.

## Constats

1. **Scripts Standard trop courts.** 9 scripts Sonnet sur 10 sont sous la durée visée (écart médian
   −15 %, jusqu'à −30 %), 6 sortent de la tolérance ; Opus les respecte toutes. Sonnet écrit moins de
   mots que la cible du prompt : à corriger dans le prompt du script, puis à remesurer. Une partie de
   l'écart Standard/Premium pourrait se résorber là.
2. **Texte des miniatures de plus de 4 mots** : Haiku dépasse la limite même après réparation
   (`fr-sante-sommeil`, `fr-short-flamants` en Premium), ce qui fait échouer l'asset. Un SEO invalide
   aussi en Standard (`pt-animais-amazonia`, détail non enregistré à ce moment-là). À traiter dans les
   prompts des dérivés (exemples de textes courts) ou par une troncature déterministe.
3. **Titres et miniatures** : critère le plus faible dans les deux formules (3,9). Le juge relève des
   titres qui promettent un développement absent du script.
4. **Injection** (`fr-injection-volcans`) : les deux formules restent sur le sujet, sans fuite du
   prompt système ni de la consigne injectée.
5. **Coût de l'évaluation** : le juge Fable représente 64 % du coût en Standard. Notes proches du
   plafond : pour départager des variantes plus proches, il faudra des briefs plus difficiles ou plus
   de passages.

## Relancer

```
EVAL_VARIANT=baseline pnpm evals run-evals   # Standard
EVAL_VARIANT=v1 pnpm evals run-evals         # Premium
EVAL_JUDGE_SANITY=1 pnpm evals judge-sanity  # contre-exemples du juge
pnpm evals:report
```

Appels réels et payants (clé dans `.env.local`). Le runner refuse de tourner si ses fichiers ou les
briefs ont changé depuis la dernière approbation : relancer alors avec `EVAL_APPROVE_HARNESS=1`.
