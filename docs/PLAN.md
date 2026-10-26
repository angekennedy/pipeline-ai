# Pipeline AI : plan d'implémentation

> Synthèse du travail de deux agents : `ecc:planner` (phases, risques, tests) et `ecc:architect` (détail technique dans [ARCHITECTURE.md](ARCHITECTURE.md)).
> Les deux agents divergeaient sur plusieurs points. Ils sont tranchés dans la section [Arbitrages](#arbitrages), qui prime sur le reste.

---

## 1. Produit

**Pipeline AI** est un SaaS Next.js. L'utilisateur saisit un brief (niche, sujet, langue, ton, durée cible, style de chaîne) et obtient en moins de 2 minutes un **pipeline de contenu YouTube faceless** prêt à produire :

| Asset | Contenu |
|---|---|
| **Script** | Hook, scènes (narration, direction visuelle, B-roll, texte à l'écran), CTA, points à vérifier (`factCheckFlags`) |
| **Titres** | 5 à 10 variantes : angle (curiosité, chiffre, question…), justification, score heuristique |
| **SEO** | Description (accroche dans les 150 premiers caractères), tags (≤ 500 caractères), hashtags, chapitres horodatés **calculés en code** |
| **Voix off** | Profil de voix et segments par scène : rythme, émotion, mots appuyés, pauses, indices de prononciation, prompt ElevenLabs |
| **Miniatures** | 3 ou 4 concepts associés chacun à un titre : prompt image, prompt négatif, composition, overlay de 4 mots maximum (couleurs, police, position) |

**Proposition de valeur :** tous les assets sont **cohérents entre eux**, parce qu'ils dérivent du même script.

### Personas

| Persona | Besoin clé | Plan |
|---|---|---|
| Side-hustler débutant (1 ou 2 chaînes) | Vitesse, savoir écrire un hook | Creator |
| Opératrice multi-chaînes (3 à 10) | Volume, style constant par chaîne, export pour ses monteurs | Pro |
| Agence ou studio | Plusieurs sièges et workspaces, historique | Studio (post-MVP) |
| Créateur non anglophone (FR, ES, PT, DE, IT) | Qualité native, pas de traduction | Tous |

### Périmètre

**MVP :**
- brief, puis 5 assets, avec le streaming des scènes du script ;
- régénération d'un asset avec consigne ;
- versions et restauration ;
- presets de chaîne ;
- auth (magic link et Google) ;
- crédits et Stripe ;
- exports Markdown, JSON, TXT, SRT et ZIP.

**Post-MVP :**
- TTS intégré (ElevenLabs) et génération d'images (Flux) ;
- recherche de sujets et de tendances ;
- analyse de chaînes concurrentes ;
- plusieurs sièges (UI Team) et API publique ;
- génération en masse par CSV ;
- export Notion, Google Docs, CapCut ;
- régénération d'une seule scène.

---

## Arbitrages

| # | Sujet | Planner | Architect | **Décision** | Raison |
|---|---|---|---|---|---|
| A1 | Modèle du script | Opus partout | Sonnet par défaut, Opus en Premium | **`claude-sonnet-5-5` en standard, `claude-opus-5-5` en Premium, `claude-haiku-5-5` pour les dérivés** | Le script représente la majorité du coût. Le palier Premium devient un levier d'upsell. À confirmer par l'évaluation de la phase 1 : si Sonnet obtient moins de 4/5, on revoit la décision. |
| A2 | Streaming du script | SSE dans un Route Handler, puis Inngest pour les dérivés | Tout dans Inngest, avec Supabase Realtime Broadcast | **Inngest pour tout et Broadcast** (ADR-001, ADR-003) | Génération durable, rechargement de page sans perte, un seul chemin de code. Le SSE lié à la requête perd le travail si l'onglet se ferme. |
| A3 | Ordre du DAG | 4 dérivés en parallèle | `titles`, puis 3 dérivés en parallèle | **`script` → `titles` → (`seo` ∥ `voiceover` ∥ `thumbnails`)** | La miniature complète un titre précis. Le cache Haiku est écrit une seule fois. Le surcoût est de 2 à 4 s. |
| A4 | Locataire (tenant) | `user_id` | `workspace_id` + membres | **Workspaces dès la migration 0001**, un seul membre visible dans l'UI au MVP | Coûte peu maintenant. Migrer plus tard vers les plans Team/Studio coûterait cher. |
| A5 | Mutations | Route Handlers `/api/pipelines/*` | Server Actions | **Server Actions** pour l'UI. Route Handlers uniquement pour Stripe, Inngest et l'export. | Moins de surface d'API, contrôle d'origine natif. |
| A6 | Tarif en crédits | Forfait de 10 ou 20 crédits | Coût par asset, indexé sur la durée | **Coût par asset** (ARCHITECTURE §5.1). Le **total** s'affiche avant le lancement. | Remboursement partiel naturel si le pipeline finit en `partial`, marge maîtrisée sur les vidéos longues. |
| A7 | Chapitres et durées | Calculés en code | Calculés en code | **Accord** (ADR-008) | Le LLM ne fait pas d'arithmétique fiable. |
| A8 | Sortie structurée | Structured outputs | Tool use forcé + Zod + une réparation | **Sorties structurées natives (`output_config.format`) + Zod + une réparation** (ADR-002, révisée) | Le tool use forcé (`tool_choice: tool`) renvoie une 400 sur Opus 5.5 et Sonnet 5.5. Le JSON est streamé en deltas de texte. L'API ignore les bornes du schéma : Zod les revalide côté serveur. |

---

## 2. Stack

- Next.js 15+ (App Router), TypeScript strict, Tailwind v4, shadcn/ui, react-hook-form, Zod v4
- Supabase : Postgres, Auth, RLS, Realtime Broadcast. Accès par supabase-js, migrations SQL, sans ORM.
- Inngest : DAG durable, retries, idempotence, concurrence par workspace
- SDK Anthropic. Les IDs de modèles sont centralisés dans `src/lib/ai/models.ts` et surchargeables par variables d'environnement.
- Stripe : Checkout, Customer Portal, webhooks. Le registre de crédits est tenu dans Postgres.
- Postgres (Supabase) : rate limiting et disjoncteur de dépense, plutôt qu'Upstash Redis (tâche 4.5)
- Sentry, logs pino, PostHog, table `generations` (tokens, coût, latence)
- Vitest, Testing Library, MSW, `@inngest/test`, Playwright, suite `evals/`
- Vercel Pro (Fluid compute, `maxDuration` élevé sur `/api/inngest`)

L'arborescence, le schéma SQL, les politiques RLS, les schémas Zod, les prompts, le cache et les webhooks sont détaillés dans [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 3. Phases

> Estimations pour un développeur full-stack à temps plein, en jours, buffer compris. **Total : 7 à 9 semaines.**
> La règle : TDD (le test d'abord), 80 % de couverture au minimum, 95 % sur `lib/pipeline`, `lib/billing` et les fonctions de crédit.

### Phase 0 : fondations (2 à 3 j)

| # | Tâche | Critère d'acceptation |
|---|---|---|
| 0.1 | Next.js, TS strict (`noUncheckedIndexedAccess`), ESLint, Prettier, pnpm, `.nvmrc` | `pnpm build` passe |
| 0.2 | Tailwind et shadcn/ui (button, input, select, card, tabs, dialog, sonner, badge, skeleton) | Composants rendus |
| 0.3 | `src/lib/env.ts` : validation Zod, séparation serveur et client, `.env.example` | Le build échoue si une variable manque. Aucun secret en `NEXT_PUBLIC_`. |
| 0.4 | Supabase local, migrations `0001_core` → `0005_realtime`, types générés | `supabase db reset` passe. Un test vérifie que **toutes** les tables ont la RLS active. L'utilisateur B ne lit rien du workspace A. |
| 0.5 | Vitest, MSW (mock Anthropic, y compris le streaming), seuils de couverture | `pnpm test` vert |
| 0.6 | Playwright et smoke test | Vert en local |
| 0.7 | CI GitHub Actions : lint, typecheck, test, build, e2e sur preview | Une PR est bloquée si la CI est rouge |
| 0.8 | Vercel, Supabase staging, Sentry, Inngest Cloud | Un déploiement de preview par PR |

### Phase 1 : génération (9 à 11 j), chemin critique

Le travail se fait derrière un compte de dev seedé. Il s'agit de **valider la qualité avant tout le reste**.

| # | Tâche | Critère d'acceptation |
|---|---|---|
| 1.1 | Schémas Zod (brief et 5 assets), écrits en TDD | Cas valides et invalides couverts. `z.toJSONSchema` testé. |
| 1.2 | `lib/ai` : `client`, `models`, `pricing`, coût en micro-USD | Coût correct sur un usage fictif |
| 1.3 | `callStructured` et `streamStructured` : tool forcé, une réparation Zod, relance sur `max_tokens`, erreurs typées (`SCHEMA_INVALID`, `CONTENT_REFUSED`) | Tests MSW : JSON invalide → réparation → succès. Deux échecs → erreur non relancée. Refus → erreur typée. |
| 1.4 | Post-traitements : timing (mots par minute selon la langue), chapitres (règles YouTube), tags | 100 % de couverture |
| 1.5 | Prompts versionnés, `renderUntrusted()`, ordre favorable au cache | Snapshots des prompts. Un brief contenant une injection reste traité comme une donnée. |
| 1.6 | Registre d'assets, DAG, `generateAsset` idempotent | Un retry après succès ne déclenche **pas** de nouvel appel au LLM |
| 1.7 | Fonction Inngest `run-pipeline` (A3) avec `finalize` | Un échec SEO simulé donne `partial` avec les 4 autres assets présents. Un échec du script ne lance pas les dérivés. |
| 1.8 | Broadcast throttlé et `use-pipeline-channel` | Scènes envoyées seulement quand elles sont complètes. Le rechargement relit l'état en DB. |
| 1.9 | UI : `BriefForm`, `SceneStream`, `AssetTabs`, copie en un clic | Première scène visible en moins de 10 s. États vide, chargement, `partial` et erreur gérés. |
| 1.10 | Régénération, versions, obsolescence, édition manuelle | Régénérer les titres ne touche pas aux autres assets. Régénérer ou éditer le script marque les dérivés `stale`. Restauration possible. |
| 1.11 | `evals/` v0 : 10 briefs de référence, contrôles déterministes, juge LLM | Rapport de référence commité |

**Point de passage (go/no-go) :** relecture humaine de 20 pipelines (4 niches × 5 langues). La moyenne doit atteindre 4/5. Ce point tranche aussi A1, Sonnet ou Opus en standard.

### Phase 2 : auth, workspaces, historique (5 à 6 j)

| # | Tâche | Critère d'acceptation |
|---|---|---|
| 2.1 | Supabase Auth (magic link et Google), callback, middleware | Les routes `(app)` redirigent vers `/login` |
| 2.2 | Trigger à l'inscription : profil, workspace personnel, `grant` des crédits Free | Un nouvel utilisateur peut générer immédiatement |
| 2.3 | Routes `/w/[workspaceSlug]/…`, vérification d'appartenance dans le layout et dans chaque Server Action | Test d'intégration : B reçoit un 404 sur les pipelines et les canaux Realtime de A |
| 2.4 | Dashboard : liste paginée, recherche, duplication d'un brief | État vide avec CTA |
| 2.5 | Presets de chaîne (CRUD), `channel_snapshot` figé dans chaque pipeline | Un preset préremplit le brief. Une évaluation montre l'influence du preset sur les titres. |
| 2.6 | Paramètres, suppression du compte (RGPD) | Suppression en cascade et annulation de l'abonnement Stripe |

### Phase 3 : facturation et crédits (5 à 6 j)

| # | Tâche | Critère d'acceptation |
|---|---|---|
| 3.1 | `credit_op` et `create_pipeline_with_reservation` (ARCHITECTURE §3, §5.2) | **Test de concurrence :** 10 réservations simultanées de 10 crédits sur un solde de 15 donnent exactement 1 succès |
| 3.2 | Réservation, capture par asset dans la transaction de version, libération du reliquat, balayage cron des réservations orphelines | Un double clic débite une seule fois. Un échec du script libère 100 %. Un pipeline `partial` libère l'asset échoué. |
| 3.3 | Produits Stripe (seed), Checkout, Customer Portal | Paiement test → `/billing?success=1` |
| 3.4 | Webhook (signature, déduplication dans `stripe_events`), fonction `stripe-sync` qui relit l'objet Stripe | Fixtures d'événements. `stripe trigger` en local. Idempotence prouvée par un test. |
| 3.5 | UI : tarifs, badge de crédits, coût affiché avant le lancement, modal « crédits insuffisants » | Le coût est visible avant chaque action |
| 3.6 | Restrictions par plan : durée maximale, palier Premium, nombre de presets, abonnement `past_due` | Free limité à 10 min, avec un 403 explicite |

### Phase 4 : finitions et production (5 à 7 j)

| # | Tâche | Critère d'acceptation |
|---|---|---|
| 4.1 | Exports MD, JSON, TXT voix off, SRT et ZIP, avec un rappel de déclaration du contenu IA | Le SRT est validé par un parseur. Le TXT se colle tel quel dans ElevenLabs. |
| 4.2 | Éditeur inline du script (version `user_edit`) | Versionné et réutilisable pour une régénération |
| 4.3 | UX : compteurs de caractères SEO, aperçu mobile de la miniature (overlay en CSS), raccourcis | Lighthouse ≥ 90 |
| 4.4 | i18n de l'UI en FR et EN (`next-intl`) | 100 % des chaînes traduites |
| 4.5 | Rate limits, disjoncteur de dépense, modération des niches interdites | 429 au-delà de la limite. Brief refusé sans débit de crédits. |
| 4.6 | Vue `v_pipeline_economics`, page admin, alertes (coût > 3× la médiane, échecs > 5 %, réservations orphelines) | Coût et marge par pipeline visibles |

### Phase 5 : lancement (3 à 5 j)

| # | Tâche | Critère d'acceptation |
|---|---|---|
| 5.1 | Landing page (pipeline d'exemple réel), pricing, FAQ, OG, sitemap | Lighthouse SEO ≥ 95 |
| 5.2 | CGU, confidentialité (sous-traitants : Anthropic, Stripe, Supabase), charte d'usage de l'IA et de YouTube | Liens dans le footer et au checkout |
| 5.3 | PostHog : funnel inscription → 1er pipeline → paiement, sans données personnelles | Funnel visible |
| 5.4 | Onboarding : brief d'exemple en un clic | Moins de 2 min pour obtenir le premier pipeline |
| 5.5 | Mise en production : Stripe en live, PITR Supabase, plafonds Anthropic, `docs/runbook.md` | Checklist validée |
| 5.6 | Bêta fermée (20 à 50 créateurs), puis lancement public | NPS ≥ 30, aucun P0 ouvert |

| Phase | Durée | Cumul | Ce qui est livrable à la fin |
|---|---|---|---|
| 0 | 2 à 3 j | 3 j | Socle et CI |
| 1 | 9 à 11 j | ~14 j | Démo interne de qualité |
| 2 | 5 à 6 j | ~20 j | Bêta gratuite sur invitation |
| 3 | 5 à 6 j | ~26 j | Monétisable |
| 4 | 5 à 7 j | ~33 j | Prêt pour la production |
| 5 | 3 à 5 j | ~38 j | Lancement |

---

## 4. Risques

| Risque | Mitigation |
|---|---|
| **Coût LLM** | Sonnet en standard (A1), Haiku pour les dérivés. Cache du préfixe partagé par les dérivés, avec plus de 60 % de lecture en cache visé. `max_tokens` borné selon la durée. Crédits indexés sur la durée. Disjoncteur de dépense. Marge suivie via `v_pipeline_economics`. |
| **Timeouts Vercel** | Une étape Inngest par asset. Au-delà de 30 min de vidéo, mode plan puis sections (une étape par acte). La DB est la source de vérité. |
| **Qualité inégale** | Few-shot par langue. Validateurs déterministes. Prompts versionnés. Évaluations bloquantes en CI. 👍/👎 par asset, réinjectés dans le jeu de données. |
| **Politique YouTube** (contenu « inauthentique », déclaration du contenu synthétique) | Positionner l'outil comme un assistant de production. Consigne d'originalité dans les prompts. Rappel de déclaration dans l'export. Pas de génération en masse au MVP. Détection des briefs quasi dupliqués. |
| **Abus** (niches interdites, YMYL, farming de crédits gratuits) | Modération du brief avant débit. Avertissement YMYL et `factCheckFlags`. Rate limits. Turnstile. Blocage des e-mails jetables. Crédits Free bas. |
| **Injection de prompt** | `renderUntrusted()`, aucun outil à effet de bord, sortie validée par Zod, rendu en texte uniquement. |
| **Double débit, désordre des webhooks** | `unique(idempotency_key)`, `FOR UPDATE`, idempotence Inngest, relecture des objets Stripe, réconciliation hebdomadaire. |
| **Disponibilité des modèles** | IDs configurables par variable d'environnement, test au démarrage, modèle de repli, remboursement automatique. |

---

## 5. Stratégie de test

| Niveau | Outils | Cibles |
|---|---|---|
| Unitaire | Vitest | Schémas, post-traitements, coûts, DAG, constructeurs de prompts (snapshots), exports |
| Composants | Testing Library | `BriefForm`, `SceneStream` (états), `AssetTabs`, `VersionHistory` |
| Intégration | Supabase local, MSW, `@inngest/test` | `run-pipeline` (succès, `partial`, échec du script), RLS et canaux Realtime, concurrence des crédits, webhooks |
| E2E | Playwright sur preview avec `AI_MOCK=1` | Inscription → brief → pipeline → régénération → export. Achat test → crédits. Crédits insuffisants → upsell. |
| **Évaluations LLM** | `evals/run-evals.ts`, déclenchées par un changement de prompts ou de modèles, et chaque nuit | 40 à 60 briefs (8 niches × 5 langues, plus des cas limites et des injections) |

**Contrôles déterministes des évaluations :**
- schéma valide ;
- durée à ±15 % de la cible ;
- langue détectée identique à la langue demandée ;
- titres ≤ 100 caractères, dont au moins 60 % ≤ 60 caractères ;
- tags ≤ 500 caractères ;
- chapitres conformes aux règles YouTube ;
- overlay ≤ 4 mots et différent du titre associé.

**Juge LLM (Opus, notes de 1 à 5) :**
- force du hook ;
- cohérence entre script, titre et miniature ;
- respect du ton ;
- naturel de la langue ;
- originalité.

**Blocage d'une PR :** si le score moyen baisse de plus de 0,2 ou si un contrôle déterministe régresse.

---

## 6. Critères de succès

- [ ] Pipeline de 8 min généré en moins de 90 s au p50 et moins de 150 s au p95, première scène visible en moins de 10 s
- [ ] Assets cohérents entre eux, régénération isolée par asset
- [ ] Taux d'échec hors refus inférieur à 2 %, libération automatique des crédits
- [ ] Double débit impossible (test de concurrence vert), webhooks idempotents
- [ ] Aucune fuite entre workspaces, y compris par Realtime
- [ ] Coût LLM moyen inférieur ou égal à 1/3 de la valeur des crédits consommés
- [ ] Couverture ≥ 80 %, évaluations au-dessus des seuils, e2e verts
- [ ] Exports utilisables tels quels dans ElevenLabs, Midjourney/Flux et YouTube Studio

---

## 7. Démarrage

1. Phase 0 (0.1 à 0.5) : environ 1,5 jour
2. 1.1 (schémas) et 1.4 (post-traitements) en TDD : c'est le contrat du système
3. 1.2, 1.3 et 1.5, puis **le script au plus tôt** : sa qualité décide du produit
4. 1.11 : évaluation sur 10 briefs **avant** de construire l'UI

## 8. Questions ouvertes (à trancher par le porteur du projet)

1. **Grille tarifaire et devise** : Free 30 crédits, Creator, Pro, Studio (ARCHITECTURE §5.1). EUR seulement, ou EUR et USD ?
2. **Palier Premium (Opus)** dès le MVP, ou après la bêta ?
3. **TTS et images intégrés** : post-MVP par défaut. Faut-il les avancer s'ils sont un différenciateur clé ?
4. **Langues du MVP** : FR, EN, ES, PT, DE, avec IT en option
5. **Vercel Pro** (nécessaire pour `maxDuration` élevé) et **Inngest Cloud** : budgets d'infrastructure validés ?
