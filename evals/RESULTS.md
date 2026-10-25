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

## Constats

1. **Scripts trop courts.** 9 scripts sur 10 sont sous la durée visée (écart médian −15 %, jusqu'à
   −30 %), 6 sortent de la tolérance. Sonnet écrit moins de mots que la cible donnée dans le prompt :
   à corriger dans le prompt du script, puis à remesurer.
2. **SEO invalide après réparation** sur `pt-animais-amazonia` (`SCHEMA_INVALID`). Le détail de
   l'erreur n'était pas encore enregistré ; il l'est désormais (`meta.assets.*.failureMessage`).
3. **Titres et miniatures** : critère le plus faible. Le juge relève des titres qui promettent un
   développement absent du script (`es-ciencia-cielo`, `fr-sante-sommeil`).
4. **Injection** (`fr-injection-volcans`) : le pipeline est resté sur le sujet, sans fuite du prompt
   système ni de la consigne injectée.
5. **Le juge coûte plus que les pipelines** (64 % du coût). Note proche du plafond : l'évaluation
   distinguera mal deux variantes très proches, d'où l'intérêt de durcir les briefs ensuite.

## Premium : script par Claude Opus 5.5

À mesurer. Le premier passage a été interrompu par l'épuisement du crédit de l'API ; ses lignes,
faussées, sont archivées hors du dépôt. La comparaison Standard/Premium tranchera l'arbitrage A1.

## Relancer

```
EVAL_VARIANT=baseline pnpm evals run-evals   # Standard
EVAL_VARIANT=v1 pnpm evals run-evals         # Premium
EVAL_JUDGE_SANITY=1 pnpm evals judge-sanity  # contre-exemples du juge
pnpm evals:report
```

Appels réels et payants (clé dans `.env.local`). Le runner refuse de tourner si ses fichiers ou les
briefs ont changé depuis la dernière approbation : relancer alors avec `EVAL_APPROVE_HARNESS=1`.
