# Pipeline AI : architecture technique

> Produit par l’agent `ecc:architect`. Les arbitrages avec le plan d’implémentation sont dans [PLAN.md](PLAN.md#arbitrages) et priment sur ce document en cas de divergence.

---

## 0. Ce que je change dans la stack proposée

| Choix supposé | Verdict | Ajustement |
|---|---|---|
| Next.js App Router + TS, Tailwind/shadcn | Je garde | Server Actions pour les mutations, Route Handlers seulement pour les webhooks, Inngest et l'export. |
| Supabase (Postgres/Auth/RLS) | Je garde | Le client du worker est en service role, isolé par `server-only`. Pour l'accès aux données : supabase-js avec types générés et migrations SQL, sans ORM. |
| Opus pour tout script | À ajuster | Le modèle se choisit **par plan** : la génération Sonnet courante par défaut, Opus en "Premium". Le coût d'un pipeline dépend surtout du script. Le choix du modèle pèse plus sur la marge que le prompt caching. |
| Haiku pour les assets dérivés | Je garde | La sortie du Haiku est validée par Zod, avec une tentative de réparation. |
| Structured outputs / tool use + streaming | Je garde, en précisant | **Tool use forcé** (`strict` si le modèle le supporte) et streaming `input_json_delta`, puis validation Zod systématique. Le forçage d'outil est incompatible avec l'extended thinking. Si on veut du thinking sur le script, il faut passer par les structured outputs natifs. |
| Vercel seul | Insuffisant | Le script Opus en streaming dure de 1 à 4 min. Il faut un orchestrateur durable (Inngest, ADR-001). Le temps réel passe par Supabase Realtime Broadcast, pas par du SSE lié à la requête. |
| Stripe abonnements + crédits | Je garde | Le registre de crédits est tenu dans Postgres, avec une logique **réservation, capture, libération**. Je n'utilise pas Stripe metered billing. |
| Calculs faits par le LLM (timestamps, compte de caractères) | Je refuse | Ces calculs sont faits en **TypeScript, de façon déterministe**. Le LLM ne fait pas d'arithmétique fiable. |

Vérification produit : la politique de monétisation YouTube sur le contenu "inauthentique/répétitif" vise directement les chaînes faceless produites en masse. YouTube impose aussi la déclaration des contenus synthétiques. Il faut des garde-fous d'originalité et un rappel de déclaration dans l'export.

---

## 1. Diagramme et responsabilités

```
                          ┌───────────────────────────── Vercel ─────────────────────────────┐
 Navigateur               │  Next.js App Router                                               │
 ┌──────────────┐  RSC /  │  ┌──────────────┐  ┌────────────────┐  ┌───────────────────────┐ │
 │ UI shadcn    │ Server  │  │ RSC pages    │  │ Server Actions │  │ Route Handlers        │ │
 │ BriefForm    │ Actions │  │ (lecture via │  │ createPipeline │  │ /api/inngest (serve)  │ │
 │ SceneStream  │────────▶│  │  RLS)        │  │ regenerateAsset│  │ /api/webhooks/stripe  │ │
 │ AssetTabs    │         │  └──────┬───────┘  │ editAsset ...  │  │ /api/pipelines/[id]/  │ │
 └──────┬───────┘         │         │          └───┬────────┬───┘  │   export              │ │
        │ WS (Broadcast   │         │              │        │      └───┬──────────▲────────┘ │
        │  privé + RLS)   │         │   rate limit │        │ event    │ steps    │          │
        │                 │         │   (Upstash)  │        ▼          ▼          │          │
        │                 │         │              │   ┌──────────────────────────┴───────┐  │
        │                 │         │              │   │ Fonctions Inngest (lib/jobs)     │  │
        │                 │         │              │   │ run-pipeline / regenerate-asset  │  │
        │                 │         │              │   │ DAG, retries, idempotence,       │  │
        │                 │         │              │   │ concurrence par workspace        │  │
        │                 │         │              │   └──┬──────────────┬────────────┬───┘  │
        └─────────────────┼─────────┼──────────────┼──────┼──────────────┼────────────┼──────┘
                          │         ▼              ▼      ▼              ▼            │
                 ┌────────┴──────────────────────────────────┐  ┌──────────────┐ ┌───┴───────┐
                 │ Supabase                                   │  │ API Anthropic│ │ Stripe    │
                 │ Postgres (RLS, fonctions crédits)          │  │ Opus/Sonnet  │ │ Checkout, │
                 │ Auth                                       │  │ (script)     │ │ Portal,   │
                 │ Realtime Broadcast (pipeline:<id>)         │  │ Haiku        │ │ Webhooks  │
                 └────────────────────────────────────────────┘  │ (dérivés)    │ └───────────┘
                                                                 └──────────────┘
           Transverse : Sentry (erreurs), logs pino + pipelineId, table generations (tokens/coûts),
                        tableau de bord Inngest, Upstash Redis (rate limit + disjoncteur de dépense)
```

| Composant | Responsabilité | Ne fait pas |
|---|---|---|
| Pages RSC | Lecture sous RLS (client utilisateur), rendu initial | Aucun appel LLM |
| Server Actions | Validation Zod du brief, rate limit, réservation de crédits, création des lignes, envoi d'un événement Inngest. Réponse en moins de 300 ms. | Aucun travail long |
| `/api/inngest` | Exécute les étapes, avec `maxDuration` élevé (Fluid compute) | Aucune logique métier propre : il délègue à `lib/pipeline` |
| `lib/pipeline` | Registre des assets, DAG, contexte, post-traitement déterministe, gestion de l'obsolescence | Aucune connaissance de Stripe ni de l'UI |
| `lib/ai` | Client Anthropic, `callStructured`, streaming, cache, calcul du coût en tokens | Aucun accès DB métier |
| `lib/billing` | Coûts en crédits, appels RPC atomiques, mapping Stripe | Aucun appel LLM |
| Postgres | Source de vérité : versions immuables, registre de crédits, RLS | |
| Realtime Broadcast | Progression et tokens partiels, de façon éphémère | Ce n'est pas une source de vérité |

---

## 2. Arborescence

```
pipeline-ai/
├─ supabase/
│  ├─ migrations/ 0001_core.sql 0002_billing.sql 0003_rls.sql 0004_credit_fns.sql 0005_realtime.sql
│  └─ seed.sql
├─ src/
│  ├─ app/
│  │  ├─ (marketing)/page.tsx, pricing/page.tsx
│  │  ├─ (auth)/login/page.tsx, auth/callback/route.ts
│  │  ├─ (app)/w/[workspaceSlug]/
│  │  │  ├─ layout.tsx                       # vérifie l'appartenance, fournit le workspace
│  │  │  ├─ dashboard/page.tsx
│  │  │  ├─ pipelines/new/page.tsx           # BriefForm
│  │  │  ├─ pipelines/[pipelineId]/page.tsx  # vue live + onglets d'assets + historique des versions
│  │  │  ├─ channels/page.tsx, channels/[channelId]/page.tsx   # presets
│  │  │  ├─ billing/page.tsx                 # solde, registre, portail
│  │  │  └─ settings/members/page.tsx
│  │  └─ api/
│  │     ├─ inngest/route.ts                 # serve() ; export const maxDuration = 800
│  │     ├─ webhooks/stripe/route.ts         # corps brut + vérification de signature
│  │     └─ pipelines/[id]/export/route.ts   # GET md/json/txt (zip)
│  ├─ server/actions/          # 'use server' uniquement : fines, appellent lib/*
│  │  ├─ pipelines.ts  (createPipeline, cancelPipeline)
│  │  ├─ assets.ts     (regenerateAsset, editAssetVersion, restoreVersion)
│  │  ├─ channels.ts   billing.ts (createCheckout, openPortal)  workspaces.ts
│  ├─ lib/
│  │  ├─ env.ts                         # env validé par Zod, séparé serveur/client
│  │  ├─ supabase/ server.ts browser.ts admin.ts(server-only, service role) database.types.ts
│  │  ├─ ai/
│  │  │  ├─ client.ts models.ts pricing.ts
│  │  │  ├─ structured.ts               # callStructured / streamStructured
│  │  │  ├─ partial-json.ts             # parse partiel des scènes pendant le stream
│  │  │  ├─ prompts/ shared.ts script.ts titles.ts seo.ts voiceover.ts thumbnails.ts
│  │  │  └─ schemas/ brief.ts script.ts titles.ts seo.ts voiceover.ts thumbnails.ts index.ts
│  │  ├─ pipeline/
│  │  │  ├─ registry.ts                 # AssetDefinition par type
│  │  │  ├─ dag.ts                      # tri topologique, construit depuis dependsOn
│  │  │  ├─ context.ts                  # charge brief + preset + versions courantes
│  │  │  ├─ generate-asset.ts           # appel, validation, persistance version, capture crédits
│  │  │  ├─ postprocess/ timing.ts chapters.ts tags.ts
│  │  │  └─ staleness.ts
│  │  ├─ jobs/ client.ts events.ts functions/run-pipeline.ts functions/regenerate-asset.ts functions/stripe-sync.ts
│  │  ├─ billing/ costs.ts plans.ts credits.ts stripe.ts webhook-handlers.ts
│  │  ├─ realtime/ broadcast.ts         # émission serveur throttlée
│  │  ├─ security/ ratelimit.ts untrusted.ts spend-guard.ts
│  │  └─ observability/ logger.ts sentry.ts
│  ├─ components/ ui/(shadcn) pipeline/{BriefForm,SceneStream,AssetTabs,VersionHistory,StaleBadge}.tsx
│  └─ hooks/ use-pipeline-channel.ts
├─ evals/ briefs.golden.json run-evals.ts      # régression des prompts en CI
└─ tests/ unit (postprocess, costs, dag) / integration (fonctions SQL de crédits via supabase local)
```

**Règle de répartition :** les Server Actions servent aux mutations déclenchées par l'UI authentifiée. Les Route Handlers servent aux appelants externes (Stripe, Inngest), aux téléchargements GET et à une éventuelle API publique future.

> **Révision (octobre 2026, tâche 2.1).** Connexion Supabase Auth par lien magique et Google.
>
> **Filtre du proxy.** `src/lib/supabase/proxy.ts` rafraîchit la session. Il renvoie ensuite vers `/login?next=…` toute route listée dans `APP_ROUTE_PREFIXES` (`src/lib/auth/routes.ts` : `/dashboard`, `/pipelines/new`, `/w`, `/settings`). Une session ouverte sur `/login` est renvoyée vers sa destination.
> - Ce filtre est optimiste, sur le cookie. Chaque page et chaque Server Action revérifient l'utilisateur avec `requireUser` (`src/lib/auth/session.ts`, couche d'accès aux données).
> - `getUser` appelle `connection()` avant de créer le client Supabase. Celui-ci lit l'heure dès sa création, ce que Next refuse pendant le prérendu à la requête.
>
> **Lien magique.**
> - Le gabarit d'e-mail (`supabase/templates/magic-link.html`) pointe vers `/auth/confirm?token_hash=…&type=email`, qui vérifie le jeton côté serveur avec `verifyOtp`. Le lien fonctionne donc aussi sur un autre appareil que celui qui l'a demandé.
> - La destination est gardée dans le cookie `auth_next`, valable une heure et filtré par `safeNext` contre les redirections ouvertes, plutôt que dans l'URL de l'e-mail.
> - La réponse est la même que l'adresse soit inscrite ou non.
>
> **Google.**
> - Le flux OAuth PKCE revient sur `/auth/callback`, qui appelle `exchangeCodeForSession`.
> - Le bouton n'apparaît qu'avec `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true`. En local, le fournisseur est désactivé faute d'identifiants.
>
> **Arborescence.** `/pipelines/new` passe dans le groupe `(app)`. Les pipelines de démonstration (`/pipelines/demo-*`), l'accueil et les tarifs restent publics.
>
> **CI.** Les e2e tournent dans un job `e2e` avec le Supabase local. La connexion y passe par un vrai lien magique : le jeton est généré par l'API admin (`tests/e2e/auth.ts`).

> **Révision (octobre 2026, tâche 2.2).** Migration `20261025000009_signup.sql`. Le trigger `on_auth_user_created` (`after insert on auth.users`) appelle `private.provision_user` pour toutes les voies d'inscription : lien magique, Google, API admin.
>
> **Ce qu'il crée :**
> - le profil, dont le nom vient de Google s'il existe, sinon de la partie locale de l'e-mail ;
> - un workspace personnel Free dont l'utilisateur est owner, avec un slug lisible : la partie locale translittérée et normalisée, suivie de 8 caractères de l'id ;
> - les crédits offerts (`private.signup_credits()`, en parité testée avec `PLANS.free.credits`), sous la clé `grant:signup:<user>`.
>
> **Idempotence.** La fonction est idempotente. La migration rattrape aussi les comptes créés avant elle (staging).
>
> **Côté application.** `getCurrentWorkspace` (`src/lib/workspaces/current.ts`) lit sous RLS le workspace personnel et son solde. Il alimente le badge de l'en-tête, le formulaire et la Server Action. Le solde de démonstration (`src/lib/demo/credits.ts`) est supprimé. La génération reste celle de démonstration jusqu'aux routes `/w/[workspaceSlug]` (tâche 2.3).
>
> **Abus.** Les 30 crédits offerts par inscription incitent à multiplier les comptes. La parade (rate limit à l'inscription, détection des adresses jetables) relève de la tâche 4.5.

> **Révision (octobre 2026, tâche 2.3).** Routes `/w/[workspaceSlug]/…`, vérifiées à trois niveaux.
> 1. **Proxy.** Pour `/w/<slug>` et `/w/<slug>/pipelines/<id>`, une ou deux requêtes sous RLS (`workspaces` par slug, `pipelines` par id et workspace). Un workspace ou un pipeline hors de portée est réécrit vers une route inexistante : un vrai 404. C'est indispensable, car le `<Suspense>` de l'en-tête lance le streaming avant le rendu du layout. Un `notFound()` levé ensuite gardait le statut 200.
> 2. **Layout et pages** (`requireMembership`, `src/lib/workspaces/access.ts`). Ils revérifient l'appartenance et le rôle, puis rendent `not-found.tsx`. Ils sont exportés avec `instant = false` (segment bloquant).
> 3. **Server Action `createPipeline`.** Elle revérifie l'appartenance et le rôle `editor` par `findMembership`, puis enchaîne :
>    - la réservation (`createPipelineWithReservation`) ;
>    - l'envoi de `pipeline/requested`, avec un id d'événement `pipeline-requested:<id>` qui dédoublonne les rejeux ;
>    - `refresh()` pour le solde de l'en-tête, puis la redirection vers le pipeline.
>
>    Si l'envoi échoue, la réservation est libérée tout de suite (`finalize_pipeline … failed`). La clé d'idempotence est générée par la page, une par affichage du formulaire.
>
> **Vue d'un pipeline.** `loadPipelineView` (`src/lib/pipeline/load-view.ts`) relit avec le client de l'utilisateur le pipeline, ses assets, ses versions et ses échecs.
> - Un asset encore en attente dans un pipeline terminé est « sauté ».
> - Un échec s'affiche par un message prévu pour son code. Le message technique reste dans `generations` et dans Sentry.
> - L'obsolescence est calculée par `staleAssets`.
>
> La page affiche `LivePipeline` (Realtime) tant que le pipeline n'est pas terminé, puis `StaticPipeline`.
>
> **Raccourci.** `/pipelines/new` redirige vers le workspace personnel. Les pipelines de démonstration restent sous `/pipelines/demo-*`.
>
> **E2E.** Un bouchon de l'API d'événements Inngest (`tests/e2e/inngest-stub.mjs`, démarré par Playwright) reçoit les événements sans exécuter de fonction, donc sans appel au modèle. Les tests vérifient l'événement envoyé et le 404 réel pour un autre utilisateur.
>
> **Révision (octobre 2026, tâche 2.4).** Tableau de bord `/w/[workspaceSlug]/dashboard`, page d'accueil du workspace (`/w/<slug>` y redirige, comme le raccourci `/dashboard` du lien « Mes pipelines »).
> - **Liste** (`listPipelines`, `src/lib/pipeline/list.ts`) : lue avec le client de l'utilisateur, triée par `created_at desc, id desc` (index `pipelines (workspace_id, created_at desc)`), par pages de 20 avec le total exact. Une page au-delà de la dernière (PostgREST 416) renvoie vers la dernière page existante.
> - **Recherche** `?q=` : `ilike` sur la colonne générée `title` (le sujet), jokers `%` et `_` échappés, 100 caractères au plus. Pas d'index trigramme : suffisant aux volumes d'un workspace au MVP.
> - **Duplication** : `pipelines/new?from=<id>` préremplit le formulaire avec le brief et la formule (`loadBriefValues`, sous RLS et filtré par workspace). Une nouvelle clé d'idempotence est tirée : c'est un nouveau pipeline, réservé et débité normalement. Premium repasse en Standard si le plan ne l'inclut pas. Le preset de chaîne n'est pas repris avant la tâche 2.5.
> - **État vide** : CTA « Créer mon premier pipeline » pour un éditeur, message d'attente pour un lecteur.
>
> **Révision (octobre 2026, tâche 2.5).** Presets de chaîne : `/w/[workspaceSlug]/channels` (liste), `channels/new`, `channels/[channelId]` (modification, suppression).
> - **Écriture** (`src/lib/channels/store.ts`) avec le client de l'utilisateur : la RLS `ch_write` réserve les presets aux éditeurs, le trigger `channels_plan_limit` (migration 0008) refuse un preset au-delà du plan (`PlanRestrictionError`, message et lien vers les tarifs). Les Server Actions revérifient le rôle `editor`. Le proxy répond 404 sur le preset d'un autre workspace, comme pour un pipeline.
> - **Formulaire** (`src/lib/channels/form.ts`) : FormData ↔ `ChannelPresetSchema`. Mots interdits et palette saisis en listes séparées par des virgules.
> - **Brief** : choisir un preset préremplit niche, langue, ton, style et public (ceux que le preset fixe, la saisie est gardée sinon). `channelId` fait partie du brief.
> - **Copie figée.** `createPipeline` relit le preset sous RLS dans le workspace et le passe à `create_pipeline_with_reservation` (`channel_snapshot`). Les prompts lisent cette copie : modifier ou supprimer le preset ne change pas un pipeline lancé (`channel_id` passe à null, la copie reste). La page du pipeline affiche le nom du preset figé.
> - **Évaluation** (`evals/preset-influence.eval.ts`, `EVAL_PRESET=1`) : sur un même script, trois jeux de titres. Le premier, sans preset, désigne les mots que le modèle emploie spontanément ; ils deviennent les mots interdits d'un preset minimal. On compare la part de titres qui les emploient : témoin sans preset contre passage avec preset.
>
> **Révision (octobre 2026, tâche 2.6).** Paramètres (`/settings`, lien sur l'adresse e-mail de l'en-tête) : nom affiché (`profiles`, policy own_profile), nom des workspaces dont l'utilisateur est admin, suppression du compte.
> - **Suppression (RGPD)** : l'utilisateur retape son adresse e-mail ; la Server Action la revérifie, puis appelle `deleteAccount` (`src/lib/account/delete.ts`) en service role.
>   1. Les abonnements encore actifs des workspaces à supprimer sont annulés par un `SubscriptionCanceler`, puis marqués `canceled` sans attendre le webhook.
>   2. La RPC `delete_account` (migration 0010, service role uniquement) supprime en une transaction les workspaces dont l'utilisateur est le seul owner (cascade : pipelines, assets, versions, générations, presets, crédits et registre, abonnements), puis la ligne `auth.users` (profil, appartenances, sessions).
>   3. La session est effacée du navigateur (`signOut({ scope: "local" })`) : le JWT, encore signé, ferait sinon croire à une session ouverte.
> - **Refus, sans rien supprimer** : seul owner d'un workspace qui a d'autres membres (`WORKSPACE_SHARED`, à transférer d'abord) ; abonnement resté actif (`SUBSCRIPTION_ACTIVE`, vérifié en base même si l'application l'oublie).
> - **Dans le workspace d'un autre**, les pipelines et versions de l'utilisateur restent, sans auteur (`created_by` passe à null).
> - **Stripe n'est pas encore branché.** L'annulation par défaut (`stripeNotConfigured`) refuse la suppression s'il existe un abonnement à annuler : le compte resterait facturé. Aucun abonnement ne peut être créé avant la tâche 3.3. Depuis la tâche 3.4, la Server Action passe `stripeCanceler` (`stripe.subscriptions.cancel`) quand `STRIPE_SECRET_KEY` est configurée.
>
> **Révision (octobre 2026, tâche 4.1).** Exports : `GET /api/pipelines/[id]/export?format=md|json|txt|srt|zip`, lus avec le client de l'utilisateur (RLS : 404 hors de ses workspaces, 401 sans session, 409 pour la voix off ou les sous-titres sans script). Boutons sur la page d'un pipeline terminé dont le script est prêt. Seules les versions courantes des assets prêts sont exportées (`src/lib/export/document.ts`).
> - **TXT voix off** (`spoken.ts`), à coller tel quel dans ElevenLabs : uniquement les mots prononcés, un paragraphe par segment. Les pauses `[pause:…ms]` deviennent des points de suspension, compris par tous les moteurs, plutôt qu'une balise (`<break>`) que certains liraient à voix haute. Sans voix off, la narration du script en tient lieu.
> - **SRT** (`srt.ts`) : minutage des scènes (`applyTiming`), texte en sous-titres de 2 lignes de 42 caractères au plus, une phrase par sous-titre au moins, durée de la scène partagée au prorata de la longueur, fins de ligne CRLF. Estimation, à recaler sur l'audio final. Validé par le parseur `srt-parser-2` (tests) et un contrôle strict du format.
> - **ZIP** (`fflate`) : Markdown, JSON, voix off, SRT, script, titres, description, tags, indications de voix et miniatures, plus un `LISEZ-MOI.txt`.
> - **Rappel de déclaration du contenu IA** (`AI_DISCLOSURE`) dans le Markdown, le JSON, le LISEZ-MOI et sous les boutons : vérifier les faits signalés, déclarer dans YouTube Studio un contenu réaliste modifié ou synthétique, apporter sa valeur propre (contenus répétitifs non monétisés).
> - **E2E** : Playwright démarre l'application avec `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` vides, prioritaires sur `.env.local` ; l'environnement serveur traite une variable vide comme absente. Aucun test e2e n'appelle Stripe.
>
> **Révision (octobre 2026, tâche 4.2).** Éditeur du script et régénérations, sur un pipeline terminé, pour un éditeur (`src/app/(app)/w/[workspaceSlug]/pipelines/[pipelineId]/actions.ts`).
> - **Édition** (« Modifier le script ») : titre de travail, résumé, appel à l'action et, par scène, titre, narration, direction visuelle et texte à l'écran (`src/lib/pipeline/script-form.ts`). Le reste de la version courante est conservé. `editAsset` valide comme une sortie du modèle, recalcule la durée des scènes et enregistre une version `user_edit`, gratuite. Les dérivés deviennent obsolètes.
> - **Restauration** : copie de l'ancienne version (`restore`), historique linéaire ; les dérivés produits à partir d'elle redeviennent à jour.
> - **Régénération** (`src/lib/jobs/request-regeneration.ts`), au coût d'une génération. Le solde total est vérifié d'abord, puis chaque asset est réservé avec sa clé `regen:<nonce>-<type>`. Une seule exécution `regenerate-asset` les enchaîne dans l'ordre du DAG (`then`) : les miniatures partent des titres régénérés, et chaque dérivé lit le script édité. Si l'envoi échoue, les réservations sont libérées.
> - **Facturation** (migration 0012) : `reserve_regeneration` (rôle, plan, solde, idempotente par clé) ; capture dans `commit_asset_version`, plafonnée au reliquat ; `release_regeneration` à l'échec définitif (`onFailure`, une tentative ratée pouvant être relancée) ; `sweep_stale_reservations` libère aussi une régénération restée sans activité 30 min.
> - **Affichage** : une régénération en attente ou en cours affiche l'asset « en cours », et la page se relit toutes les 4 s jusqu'à la fin (`AutoRefresh`). Sur les démonstrations ou pour un lecteur, les boutons restent désactivés.
> - **Tests** : intégration sur la vraie base (édition versionnée, dérivés régénérés à partir du script édité, prompt vérifié, capture, libération, balayage) ; la suppression de la capture des régénérations a été testée par mutation. E2E : édition, « Régénérer les dérivés » (6 crédits réservés, une exécution chaînée), restauration, exports, sur un pipeline terminé préparé par les vraies RPC (`tests/e2e/pipelines.ts`).
>
> **Révision (octobre 2026, tâche 4.3).** UX de la page d'un pipeline.
> - **Compteurs** (`src/lib/pipeline/youtube-limits.ts`, `CharCounter`) : limites de YouTube Studio comptées en caractères (un emoji vaut un caractère). Titre 100, recommandé 70 (tronqué dans le fil mobile) ; description 5 000, avec les 150 premiers caractères visibles en recherche ; tags 500, comptés comme YouTube (guillemets d'un tag à espace, virgules) ; 3 hashtags affichés au-dessus du titre.
> - **Aperçu mobile des miniatures** (`ThumbnailPreview`), en CSS seulement : fil d'accueil et colonne des suggestions, texte incrusté placé, coloré et contouré comme le concept, badge de durée en bas à droite. Un texte placé dans ce coin est signalé.
> - **Raccourcis** (`src/lib/pipeline/shortcuts.ts`) : `1` à `5` (onglets), `c` (copie principale de l'onglet, `data-shortcut-copy`), `e` (éditeur du script), `?` (aide). Ignorés pendant une saisie et avec Ctrl, ⌘ ou Alt ; désactivables dans l'aide (WCAG 2.1.4), préférence conservée dans le navigateur.
> - **Lighthouse** (Chrome DevTools, mobile, build de production) : accessibilité, bonnes pratiques et SEO à 100 sur l'accueil, les tarifs et la page d'un pipeline de démonstration, onglets SEO et Miniatures compris ; CLS 0, LCP 0,65 à 1 s avec un processeur ralenti 4 fois et une connexion « Slow 4G ». `/login` reste à 60 en SEO par choix (`noindex`). Correctifs :
>   - les métadonnées des démonstrations sont prérendues (`generateStaticParams`) : avec Cache Components, un `generateMetadata` qui lit `params` à la requête est diffusé dans le `<body>`, où Lighthouse ne trouve pas la description ;
>   - le menu du compte, chargé après la session, réserve la place du lien de connexion (CLS de 0,13 à 0) ;
>   - les intertitres des onglets passent en `h2`, sous le `h1` de la page.

---

## 3. Modèle de données

```sql
-- 0001_core.sql
create schema if not exists private;  -- non exposé par PostgREST
create type member_role    as enum ('viewer','editor','admin','owner');      -- l'ordre sert aux comparaisons
create type asset_type     as enum ('script','titles','seo','voiceover','thumbnails');
create type pipeline_status as enum ('queued','running','partial','completed','failed','canceled');
create type asset_status   as enum ('pending','running','ready','failed','stale');
create type gen_status     as enum ('queued','running','succeeded','failed');
create type version_source as enum ('ai','ai_regen','user_edit','restore');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text, locale text default 'fr', created_at timestamptz default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null,
  stripe_customer_id text unique,
  plan_key text not null default 'free',
  created_at timestamptz default now()
);

create table workspace_members (
  workspace_id uuid references workspaces on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role member_role not null default 'editor',
  primary key (workspace_id, user_id)
);
create index on workspace_members (user_id);

create table channels (               -- presets de chaîne
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  name text not null,
  niche text not null,
  default_language text not null default 'fr',
  tone text, style text,
  audience text,
  voice_profile jsonb default '{}',     -- {gender, age, accent, pace}
  brand_rules jsonb default '{}',       -- {bannedWords[], ctaTemplate, thumbnailPalette[]}
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index on channels (workspace_id);

create table pipelines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  channel_id uuid references channels on delete set null,
  created_by uuid not null references auth.users,
  brief jsonb not null,                  -- BriefSchema validé, figé à la création
  channel_snapshot jsonb,                -- copie du preset au moment T (reproductibilité)
  model_tier text not null default 'standard',   -- 'standard' | 'premium'
  status pipeline_status not null default 'queued',
  idempotency_key text not null,
  credits_reserved int not null default 0,
  title text generated always as (brief->>'topic') stored,
  created_at timestamptz default now(), completed_at timestamptz,
  unique (workspace_id, idempotency_key)
);
create index on pipelines (workspace_id, created_at desc);

create table pipeline_assets (           -- un par (pipeline, type)
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references pipelines on delete cascade,
  workspace_id uuid not null references workspaces on delete cascade,  -- dénormalisé pour la RLS
  type asset_type not null,
  status asset_status not null default 'pending',
  current_version_id uuid,               -- FK ajoutée plus bas
  unique (pipeline_id, type)
);

create table asset_versions (            -- IMMUABLE
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references pipeline_assets on delete cascade,
  workspace_id uuid not null references workspaces on delete cascade,
  version int not null,
  source version_source not null,
  content jsonb not null,                -- sortie Zod validée + post-traitée
  schema_version text not null,          -- ex. 'script@3'
  source_script_version_id uuid references asset_versions,  -- pour les dérivés : script utilisé
  generation_id uuid,                    -- null si user_edit
  created_by uuid references auth.users,
  created_at timestamptz default now(),
  unique (asset_id, version)
);
alter table pipeline_assets add constraint fk_current
  foreign key (current_version_id) references asset_versions deferrable initially deferred;
create index on asset_versions (asset_id, version desc);

create table generations (               -- un appel LLM = une ligne (job et télémétrie)
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  pipeline_id uuid not null references pipelines on delete cascade,
  asset_type asset_type not null,
  idempotency_key text not null unique,  -- ex. 'pipe:<id>:script:1' / 'regen:<nonce>'
  status gen_status not null default 'queued',
  attempt int not null default 0,
  model text, prompt_version text,
  input_tokens int, output_tokens int,
  cache_creation_tokens int, cache_read_tokens int,
  cost_usd_micros bigint,                -- calculé depuis lib/ai/pricing.ts
  latency_ms int, ttft_ms int,
  credits int not null,                  -- crédits réservés pour cet asset
  validation_repairs int default 0,
  error_code text, error_message text,
  inngest_run_id text,
  user_feedback text,                    -- consigne de régénération (non fiable)
  created_at timestamptz default now(), finished_at timestamptz
);
create index on generations (pipeline_id);
create index on generations (workspace_id, created_at desc);
create index on generations (status) where status in ('queued','running');
```

```sql
-- 0002_billing.sql
create type ledger_kind as enum ('grant','purchase','reserve','capture','release','refund','adjust','expire');

create table credit_accounts (            -- solde matérialisé, verrouillé avec FOR UPDATE
  workspace_id uuid primary key references workspaces on delete cascade,
  balance int not null default 0 check (balance >= 0),
  reserved int not null default 0 check (reserved >= 0),
  check (reserved <= balance),
  updated_at timestamptz default now()
);

create table credit_ledger (              -- append-only
  id bigint generated always as identity primary key,
  workspace_id uuid not null references workspaces on delete cascade,
  kind ledger_kind not null,
  amount int not null check (amount > 0),
  balance_after int not null, reserved_after int not null,
  idempotency_key text not null unique,
  pipeline_id uuid references pipelines on delete set null,
  generation_id uuid references generations on delete set null,
  stripe_ref text, metadata jsonb default '{}',
  created_at timestamptz default now()
);
create index on credit_ledger (workspace_id, created_at desc);

create table subscriptions (
  id text primary key,                    -- sub_xxx Stripe
  workspace_id uuid not null references workspaces on delete cascade,
  status text not null,                   -- active, trialing, past_due, canceled...
  price_id text not null, plan_key text not null,
  current_period_end timestamptz, cancel_at_period_end boolean default false,
  updated_at timestamptz default now()
);
create index on subscriptions (workspace_id);

create table stripe_events (              -- déduplication des webhooks
  id text primary key, type text not null, received_at timestamptz default now(),
  processed_at timestamptz
);
```

### Fonctions de crédit (atomiques et idempotentes)

```sql
-- 0004_credit_fns.sql : appelées uniquement en service role
create or replace function private.credit_op(
  p_ws uuid, p_kind ledger_kind, p_amount int, p_key text,
  p_pipeline uuid default null, p_generation uuid default null, p_meta jsonb default '{}'
) returns credit_ledger language plpgsql security definer set search_path = '' as $$
declare acc public.credit_accounts; row public.credit_ledger;
begin
  -- idempotence : si la clé existe déjà, on renvoie l'écriture existante
  select * into row from public.credit_ledger where idempotency_key = p_key;
  if found then return row; end if;

  insert into public.credit_accounts(workspace_id) values (p_ws) on conflict do nothing;
  select * into acc from public.credit_accounts where workspace_id = p_ws for update;

  case p_kind
    when 'grant','purchase','refund' then acc.balance := acc.balance + p_amount;
    when 'reserve' then
      if acc.balance - acc.reserved < p_amount then
        raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
      end if;
      acc.reserved := acc.reserved + p_amount;
    when 'capture' then acc.reserved := acc.reserved - p_amount; acc.balance := acc.balance - p_amount;
    when 'release' then acc.reserved := acc.reserved - p_amount;
    when 'adjust','expire' then acc.balance := greatest(acc.reserved, acc.balance - p_amount);
  end case;

  update public.credit_accounts set balance = acc.balance, reserved = acc.reserved, updated_at = now()
   where workspace_id = p_ws;
  insert into public.credit_ledger(workspace_id, kind, amount, balance_after, reserved_after,
                                   idempotency_key, pipeline_id, generation_id, metadata)
  values (p_ws, p_kind, p_amount, acc.balance, acc.reserved, p_key, p_pipeline, p_generation, p_meta)
  returning * into row;
  return row;
end $$;
revoke all on function private.credit_op from public, anon, authenticated;
```

Une contrainte CHECK (`reserved <= balance`, `>= 0`) sert de dernier filet de sécurité si un bug applicatif passe.

### RLS

```sql
-- 0003_rls.sql
create or replace function private.has_role(ws uuid, min_role member_role default 'viewer')
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m
                 where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role >= min_role)
$$;

alter table profiles enable row level security;          -- (idem pour toutes les tables)
create policy own_profile on profiles for all using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy ws_read  on workspaces for select using (private.has_role(id));
create policy ws_admin on workspaces for update using (private.has_role(id,'admin'));
create policy wm_read  on workspace_members for select using (private.has_role(workspace_id));
create policy wm_admin on workspace_members for all using (private.has_role(workspace_id,'admin'));

create policy ch_read  on channels for select using (private.has_role(workspace_id));
create policy ch_write on channels for all using (private.has_role(workspace_id,'editor'))
                                       with check (private.has_role(workspace_id,'editor'));

-- pipelines : lecture pour les membres ; l'INSERT passe par la Server Action en service role,
-- après réservation des crédits. Aucun INSERT direct client, ce qui évite les pipelines non réservés.
create policy pl_read on pipelines for select using (private.has_role(workspace_id));

-- assets, versions, generations, registre, comptes, abonnements : LECTURE SEULE côté client
create policy pa_read on pipeline_assets for select using (private.has_role(workspace_id));
create policy av_read on asset_versions  for select using (private.has_role(workspace_id));
create policy gen_read on generations    for select using (private.has_role(workspace_id));
create policy cl_read on credit_ledger   for select using (private.has_role(workspace_id,'admin'));
create policy ca_read on credit_accounts for select using (private.has_role(workspace_id));
create policy sub_read on subscriptions  for select using (private.has_role(workspace_id,'admin'));
-- stripe_events : RLS activée, aucune policy (accès service role uniquement)

-- 0005_realtime.sql : canaux Broadcast privés, topic 'pipeline:<uuid>'
create policy rt_pipeline_read on realtime.messages for select to authenticated using (
  realtime.topic() like 'pipeline:%'
  and exists (select 1 from public.pipelines p
              where p.id = substring(realtime.topic() from 10)::uuid
                and private.has_role(p.workspace_id))
);
```

Les éditions manuelles (`user_edit`) passent par une Server Action qui vérifie `has_role(…,'editor')`, valide le contenu par Zod, puis insère en service role. Les versions restent immuables et le chemin d'écriture est unique.

> **Révision (octobre 2026, tâche 0.4).** Les migrations sont dans `supabase/migrations/20261025000001_core.sql` → `…05_realtime.sql`.
>
> **Écarts avec le schéma ci-dessus :**
> - Les policies sont restreintes `to authenticated`.
> - Le topic Realtime est validé par l'expression régulière `^pipeline:[0-9a-f-]{36}$`, et non plus par `like` : un topic mal formé ne fait plus échouer le cast en uuid.
> - `generations` gagne `started_at`, `version_id` et `api_calls`.
> - `asset_versions` gagne `source_versions` et `restored_from` (tâche 1.10).
>
> **Store et RPC.** `SupabasePipelineStore` (`src/lib/supabase/pipeline-store.ts`) implémente `PipelineStore` en service role. Il passe par quatre RPC réservées à `service_role` :
> - `upsert_generation` ;
> - `claim_generation`, qui prend la génération avec un bail de 15 minutes. Si la génération est déjà tenue, elle renvoie `false`, et le store lève `GenerationInProgressError`, une erreur retentable que `generateAsset` laisse passer sans marquer la génération en échec ;
> - `commit_asset_version`, qui fait version, pointeur courant et télémétrie en une transaction ;
> - `mark_generation_failed`. Après une régénération ratée, l'asset redevient `ready` s'il a une version.
>
> **Route Inngest.** `/api/inngest` (`maxDuration` 300) branche les deux fonctions sur ce store et sur `createBroadcastPublisher`. Elle est exclue du proxy de session.
>
> **Tests d'intégration.** `pnpm test:integration` tourne contre le Supabase local, sans MSW, avec un job CI dédié qui vérifie aussi que `database.types.ts` est à jour. Les tests couvrent :
> - la RLS active sur toutes les tables de `public`, dont la liste est figée dans le test ;
> - l'isolation entre workspaces A et B, table par table, pour B et pour anon ;
> - les droits par rôle ;
> - les RPC refusées aux clients ;
> - le canal Realtime refusé à B et l'événement reçu par A ;
> - le contrat du store.
>
> Chaque protection a été affaiblie volontairement au moins une fois pour vérifier qu'un test échoue.

---

## 4. Orchestration IA

### 4.1 Brief et contrat d'asset

```ts
// lib/ai/schemas/brief.ts
export const BriefSchema = z.object({
  niche: z.string().trim().min(2).max(80),
  topic: z.string().trim().min(5).max(300),
  language: z.enum(['fr','en','es','de','pt','it']),          // liste blanche BCP-47
  tone: z.enum(['educational','dramatic','humorous','mysterious','inspirational','neutral']),
  durationMinutes: z.number().int().min(1).max(60),
  style: z.enum(['listicle','storytelling','documentary','explainer','top-n','true-crime']),
  targetAudience: z.string().max(200).optional(),
  extraNotes: z.string().max(2000).optional(),                  // NON FIABLE
  channelId: z.string().uuid().optional(),
});
export type Brief = z.infer<typeof BriefSchema>;

// lib/pipeline/registry.ts
export type ModelKey = 'script.standard' | 'script.premium' | 'light';
export interface PipelineContext {
  pipelineId: string; workspaceId: string;
  brief: Brief; channel: ChannelSnapshot | null;
  script?: { versionId: string; content: Script };   // présent pour les dérivés
  titles?: Titles;
  feedback?: string;                                  // régénération (non fiable)
}
export interface BuiltPrompt {
  system: Anthropic.TextBlockParam[];   // cache_control posé dans le builder
  messages: Anthropic.MessageParam[];
  toolName: string;
}
export interface AssetDefinition<T> {
  type: AssetType;
  dependsOn: AssetType[];
  model: (tier: 'standard'|'premium') => ModelKey;
  schema: z.ZodType<T>;
  schemaVersion: string;                // 'titles@2'
  promptVersion: string;                // 'titles.p5' (hash git du template au build)
  maxTokens: (b: Brief) => number;
  stream: boolean;                      // true pour le script uniquement
  build: (ctx: PipelineContext) => BuiltPrompt;
  postProcess?: (out: T, ctx: PipelineContext) => T;   // déterministe
  credits: (b: Brief) => number;
}
```

### 4.2 Schémas Zod par asset

```ts
// script.ts
export const SceneSchema = z.object({
  index: z.number().int().min(1),
  purpose: z.enum(['hook','context','development','twist','payoff','cta']),
  title: z.string().max(80),
  narration: z.string().min(20),                  // texte lu par la voix
  visualDirection: z.string().max(400),           // b-roll, stock, motion
  bRollKeywords: z.array(z.string().max(40)).max(8),
  onScreenText: z.string().max(60).nullable(),
  estimatedSeconds: z.number().int().positive(),  // ÉCRASÉ par postProcess (mots/WPM)
});
export const ScriptSchema = z.object({
  workingTitle: z.string().max(100),
  hookSummary: z.string().max(300),
  scenes: z.array(SceneSchema).min(3).max(80),
  callToAction: z.string().max(300),
  factCheckFlags: z.array(z.object({ sceneIndex: z.number().int(), claim: z.string() })).max(20),
});

// titles.ts
export const TitlesSchema = z.object({
  variants: z.array(z.object({
    title: z.string().min(10).max(100),           // limite YouTube : 100
    angle: z.enum(['curiosity_gap','number','negative','how_to','question','story','authority','urgency']),
    rationale: z.string().max(200),
    heuristicScore: z.number().min(1).max(10),    // affiché comme "heuristique", pas comme une prédiction de CTR
    charCount: z.number().int(),                  // recalculé
  })).min(5).max(10),
  recommendedIndex: z.number().int(),
});

// seo.ts
export const SeoSchema = z.object({
  description: z.string().max(5000),              // les 150 premiers caractères = accroche
  tags: z.array(z.string().max(30)).max(30),      // tronqué à 500 caractères au total en postProcess
  hashtags: z.array(z.string().regex(/^#\p{L}[\p{L}\p{N}_]*$/u)).max(3),
  chapterTitles: z.array(z.object({ startsAtSceneIndex: z.number().int(), title: z.string().max(60) })).min(3),
  // Les timestamps NE viennent PAS du LLM :
  chapters: z.array(z.object({ timestamp: z.string(), title: z.string() })).optional(), // rempli par postProcess
});

// voiceover.ts
export const VoiceoverSchema = z.object({
  globalVoice: z.object({ gender: z.enum(['male','female','neutral']), age: z.string(), accent: z.string(),
                          baseStyle: z.string().max(200) }),
  segments: z.array(z.object({
    sceneIndex: z.number().int(),
    text: z.string(),                              // narration nettoyée, pauses en [pause:600ms]
    pace: z.enum(['slow','medium','fast']),
    emotion: z.string().max(40),
    emphasisWords: z.array(z.string()).max(6),
    pauseAfterMs: z.number().int().min(0).max(3000),
    pronunciationHints: z.array(z.object({ word: z.string(), phonetic: z.string() })).max(10),
    providerPrompt: z.string().max(500),           // indications au format libre ElevenLabs/OpenAI TTS
  })),
});

// thumbnails.ts
export const ThumbnailsSchema = z.object({
  concepts: z.array(z.object({
    pairedTitleIndex: z.number().int(),            // la miniature complète le titre, ne le répète pas
    imagePrompt: z.string().max(1200),
    negativePrompt: z.string().max(400),
    composition: z.string().max(300),              // règle des tiers, gros plan, contraste
    focalEmotion: z.string().max(40),
    textOverlay: z.object({
      text: z.string().max(30).refine(s => s.trim().split(/\s+/).length <= 4, '≤ 4 mots'),
      placement: z.enum(['top-left','top-right','bottom-left','bottom-right','center']),
      colorHex: z.string().regex(/^#[0-9a-f]{6}$/i), strokeHex: z.string().regex(/^#[0-9a-f]{6}$/i),
      fontStyle: z.enum(['bold-sans','condensed','handwritten','serif-impact']),
    }),
    aspectRatio: z.literal('16:9'),
  })).min(3).max(4),
});
```

Le JSON Schema envoyé à l'API vient de `z.toJSONSchema()` (Zod v4). Le décodage contraint ne garantit pas les `refine` ni certaines bornes : la validation Zod reste systématique côté serveur.

**Post-traitements déterministes** (`lib/pipeline/postprocess`) :
- `estimatedSeconds = round(wordCount / wpm[language] * 60)`, avec par exemple fr ≈ 150 et en ≈ 155. Le pas est ensuite recalé pour atteindre la durée cible. Si l'écart dépasse 15 %, un avertissement s'affiche dans l'UI.
- Chapitres :
  - timestamps cumulés depuis les scènes ;
  - premier chapitre forcé à `00:00` ;
  - au moins 3 chapitres, d'au moins 10 s chacun (règles YouTube) ;
  - fusion automatique si une règle n'est pas respectée.
- Tags : déduplication, minuscules, troncature à 500 caractères au total. `charCount` des titres recalculé.

### 4.3 Templates de prompt (structure commune)

```ts
// lib/ai/prompts/shared.ts : l'ordre est conçu pour le cache (voir 4.7)
export function buildDerivedSystem(ctx: PipelineContext): Anthropic.TextBlockParam[] {
  return [
    { type: 'text', text: DERIVED_STATIC_INSTRUCTIONS },            // rôle, règles YouTube, format
    { type: 'text', text: renderUntrusted('channel_preset', ctx.channel) },
    { type: 'text', text: renderUntrusted('brief', ctx.brief) +
        `\n<final_script version="${ctx.script!.versionId}">${JSON.stringify(ctx.script!.content)}</final_script>`,
      cache_control: { type: 'ephemeral' } },                        // point de cache partagé par les dérivés
  ];
}
// Message utilisateur (non caché, propre à l'asset) : « Produis l'asset TITLES. <task>…</task> »
// + <user_feedback> si régénération.
```

Chaque template contient :
- le rôle (scénariste YouTube faceless ou spécialiste SEO, selon l'asset) ;
- des contraintes mesurables : nombre de scènes ≈ durée × 1,2, hook de moins de 15 s, pas d'affirmation chiffrée sans `factCheckFlags` ;
- la langue de sortie imposée ;
- l'interdiction de reprendre les instructions contenues dans les blocs `<brief>` et `<channel_preset>`.

Pour le script uniquement : un exemple de scène court (few-shot) et une consigne d'originalité, qui demande un angle propre et pas de paraphrase d'une vidéo existante.

### 4.4 DAG

> **Révision (octobre 2026, tâche 1.6).** Les dérivés ne partagent plus de cache (voir 4.7), donc faire passer `titles` en premier ne rapporte plus rien. Les étapes sont calculées depuis `dependsOn` (`src/lib/pipeline/dag.ts`) : `script` → (`titles` ∥ `seo` ∥ `voiceover`) → `thumbnails`, seul asset qui dépend des titres. Le schéma ci-dessous est conservé pour l'historique.

```
            ┌──────────┐
 brief ───▶ │  script  │  (Opus/Sonnet, streamé)
            └────┬─────┘
                 ▼
            ┌──────────┐  (Haiku : écrit aussi le cache du préfixe dérivé)
            │  titles  │
            └────┬─────┘
       ┌─────────┼──────────────┐
       ▼         ▼              ▼
     seo     voiceover     thumbnails (dépend de titles : pairedTitleIndex)
       └─────────┴──────┬───────┘
                        ▼
                    finalize (statut, capture/libération des crédits restants)
```

Faire passer `titles` en premier coûte environ 2 à 4 s de latence. En échange :
1. les miniatures peuvent s'appuyer sur les titres ;
2. le cache est écrit une seule fois avant la parallélisation. Trois requêtes parallèles lancées à froid paieraient chacune l'écriture du cache.

### 4.5 Jobs en arrière-plan : Inngest

> **Révision (octobre 2026, tâche 1.7).** Inngest v4 (`inngest@4.23.0`) : les triggers passent dans les options et les événements sont typés par `eventType()` avec Zod (`src/lib/jobs/events.ts`). L'orchestration vit dans `src/lib/pipeline/run-pipeline.ts`, sans dépendance à Inngest ; `src/lib/jobs/functions/run-pipeline.ts` ne fait que la brancher et convertir les erreurs `retryable: false` en `NonRetriableError`. La fonction est construite par une factory qui reçoit le `PipelineStore`. La route `/api/inngest` arrivera avec l'implémentation Supabase (0.4). À prévoir dans cette implémentation : une prise de génération atomique avec bail d'expiration, pour que deux exécutions simultanées d'une même étape ne paient pas deux appels au modèle.

```ts
// lib/jobs/events.ts
type Events = {
  'pipeline/requested': { data: { pipelineId: string; workspaceId: string } };
  'asset/regenerate.requested': { data: { pipelineId: string; workspaceId: string; assetType: AssetType;
                                          generationId: string; feedback?: string } };
};

// lib/jobs/functions/run-pipeline.ts
export const runPipeline = inngest.createFunction(
  {
    id: 'run-pipeline',
    idempotency: 'event.data.pipelineId',                       // double envoi : une seule exécution
    concurrency: [{ key: 'event.data.workspaceId', limit: 2 }, { limit: 50 }],  // équité + plafond global
    retries: 3,
    cancelOn: [{ event: 'pipeline/canceled', match: 'data.pipelineId' }],
    onFailure: async ({ event }) => releaseRemaining(event.data.event.data.pipelineId, 'failure'),
  },
  { event: 'pipeline/requested' },
  async ({ event, step }) => {
    const { pipelineId } = event.data;
    await step.run('mark-running', () => setPipelineStatus(pipelineId, 'running'));
    // Chaque étape renvoie un versionId (petit) ; le contenu reste en DB (limite de taille d'état des étapes).
    const scriptV = await step.run('script', () => generateAsset(pipelineId, 'script'));
    await step.run('titles', () => generateAsset(pipelineId, 'titles'));
    const results = await Promise.allSettled([
      step.run('seo',        () => generateAsset(pipelineId, 'seo')),
      step.run('voiceover',  () => generateAsset(pipelineId, 'voiceover')),
      step.run('thumbnails', () => generateAsset(pipelineId, 'thumbnails')),
    ]);
    await step.run('finalize', () => finalizePipeline(pipelineId, results));  // 'completed' | 'partial'
  },
);
```

```ts
// lib/pipeline/generate-asset.ts : cœur idempotent
export async function generateAsset(pipelineId: string, type: AssetType): Promise<string> {
  const key = `pipe:${pipelineId}:${type}`;
  const gen = await upsertGeneration(key);              // unique(idempotency_key)
  if (gen.status === 'succeeded') return gen.versionId!; // retry après réussite : pas de nouvel appel
  const def = registry[type]; const ctx = await loadContext(pipelineId, def.dependsOn);
  await markRunning(gen.id, gen.attempt + 1); broadcast(pipelineId, { type: 'asset.started', asset: type });

  const res = await callStructured({ def, ctx, onPartial: def.stream
     ? throttle(p => broadcast(pipelineId, { type: 'asset.partial', asset: type, data: p }), 250) : undefined });

  const content = def.postProcess ? def.postProcess(res.data, ctx) : res.data;
  // transaction unique (RPC) : insertion version + pointeur courant + statut + capture crédits (clé = key)
  return await commitAssetVersion({ gen, content, usage: res.usage, captureKey: `capture:${key}` });
}
```

**Erreurs et retries :**

| Cas | Traitement |
|---|---|
| 429, 529 (surcharge), 5xx, timeout réseau | Erreur relancée, retry Inngest avec backoff. Le SDK Anthropic a `maxRetries: 2`, garder ce chiffre bas pour ne pas cumuler les retries. |
| Échec de validation Zod | **Une** tentative de réparation dans la même étape : on renvoie les erreurs Zod au modèle via un message `tool_result` avec `is_error: true`. Si elle échoue, `NonRetriableError('SCHEMA_INVALID')`. |
| `stop_reason === 'max_tokens'` | Une relance avec `maxTokens × 1,5`. Si elle échoue aussi, l'erreur n'est pas relancée. |
| Refus ou contenu bloqué | `NonRetriableError('CONTENT_REFUSED')`. Les crédits de l'asset sont libérés et le message est affiché à l'utilisateur. |
| Échec du script | Les dérivés ne partent pas. `onFailure` libère toute la réservation. |
| Échec d'un dérivé | Pipeline `partial`. Seuls les crédits de cet asset sont libérés. L'utilisateur peut le régénérer. |

**Régénération par asset :**

> **Révision (octobre 2026, tâche 1.10).** Chaque version enregistre la version de **chaque** dépendance utilisée (`sourceVersions`, colonne jsonb `source_versions` à la place de `source_script_version_id`) : régénérer les titres rend aussi les miniatures obsolètes, puisque `pairedTitleIndex` s'y réfère. L'obsolescence est calculée (`src/lib/pipeline/staleness.ts`), jamais stockée : un asset est `stale` quand une dépendance a changé de version depuis sa production. Une restauration crée une copie `source='restore'` avec `restored_from` ; les dépendances sont enregistrées par leur origine, si bien qu'un dérivé redevient à jour quand on restaure la version du script dont il est issu. Édition et restauration : `src/lib/pipeline/versions.ts`. Régénération : `generateAsset` avec `regeneration: { key, feedback }`, appelé par la fonction Inngest `regenerate-asset`.
1. La Server Action `regenerateAsset(pipelineId, type, feedback?, nonce)` applique le rate limit, puis `reserve` avec la clé `regen:<nonce>`.
2. Elle crée la `generation`, puis envoie `asset/regenerate.requested`. L'idempotence Inngest porte sur `generationId`.
3. Une nouvelle version est créée avec `source='ai_regen'`.
4. Si l'asset régénéré est le **script**, tous les dérivés passent en `stale`, car leur `source_script_version_id` ne correspond plus. L'UI propose « Régénérer les dérivés (N crédits) » sans le faire d'office.
5. Une édition manuelle du script crée une version `user_edit` gratuite et rend les dérivés obsolètes de la même façon.
6. Régénération d'une seule scène : prévue en v2, en patch ciblé.

**Durées :** `export const maxDuration = 800` sur `/api/inngest`, ce qui suppose Vercel Pro avec Fluid compute. Une étape correspond à une invocation. Pour un script de plus de 30 min, il faut passer en mode **plan puis sections** : une étape `outline`, puis une étape par acte, concaténées. Chaque étape reste ainsi sous 3 min et un échec ne relance qu'un acte.

### 4.6 Streaming vers l'UI

> **Révision (octobre 2026, tâche 1.8).** Le JSON du script arrive en deltas de texte (sorties structurées), lus par `SceneStreamParser` (`src/lib/ai/partial-json.ts`, incrémental). `createSceneThrottle` (`src/lib/realtime/broadcast.ts`) envoie au plus 4 messages par seconde, avec seulement les scènes complètes et conformes à `SceneSchema`. Il repart de zéro à chaque nouveau stream (réparation, relance sur `max_tokens`) : le navigateur remplace les scènes par index. Les événements sont un seul type Broadcast (`pipeline`), validé par `PipelineEventSchema` des deux côtés. L'envoi serveur passe par `httpSend` (REST) et ne fait jamais échouer une génération. `usePipelineChannel` appelle `router.refresh()` à chaque asset terminé, à chaque changement de statut et à **chaque** abonnement réussi, y compris le premier, pour couvrir l'intervalle entre le rendu serveur et l'abonnement. Reste à faire avec les migrations (0.4) : la politique RLS de `realtime.messages` pour les canaux `pipeline:<id>`.

```ts
// lib/ai/structured.ts (extrait)
const stream = anthropic.messages.stream({
  model, max_tokens, system, messages,
  tools: DERIVED_OR_SCRIPT_TOOLS,                 // liste IDENTIQUE pour tous les dérivés (cache)
  tool_choice: { type: 'tool', name: toolName },
});
let json = '';
stream.on('inputJson', (delta) => { json += delta; onPartial?.(parsePartialScenes(json)); });
const final = await stream.finalMessage();        // usage : input/output/cache_* tokens
```

- Côté serveur, `broadcast.ts` envoie au plus 4 événements par seconde sur `pipeline:<id>`, par Realtime Broadcast (envoi REST, canal privé). Une scène n'est envoyée qu'une fois **complète** : l'UI n'affiche pas de JSON cassé.
- Côté client, `use-pipeline-channel` s'abonne avec `config: { private: true }`, met à jour `SceneStream` et appelle `router.refresh()` sur `asset.completed`. **La DB reste la source de vérité** : après une reconnexion ou un rechargement, la page RSC relit l'état. Un message Broadcast perdu n'a donc pas d'effet durable.
- Les assets Haiku ne sont pas streamés token par token, ils prennent quelques secondes. L'UI affiche des squelettes et des transitions d'état.

### 4.7 Prompt caching

> **Révision (octobre 2026, tâche 1.5).** Les sorties structurées remplacent les outils `emit_*` (ADR-002), or changer `output_config.format` invalide le cache de prompt. Les quatre dérivés ont des schémas différents : ils **ne partagent pas** de préfixe. L'ordre retenu, dans `src/lib/ai/prompts/shared.ts` :
> 1. `system` : instructions fixes de l'asset et consigne sur les données non fiables, identiques pour tous les pipelines (point de cache) ;
> 2. premier message utilisateur : preset, brief, script et titres rendus par `renderUntrusted()` en JSON à clés triées (point de cache), réutilisés par la réparation Zod et les régénérations ;
> 3. tâche (langue, cibles calculées) et feedback éventuel, après le dernier point de cache.
>
> Sur Haiku, l'économie perdue est de l'ordre de 0,002 $ par pipeline. Le minimum cacheable est de 512 tokens sur les modèles 5.x : un préfixe plus court n'est simplement pas mis en cache. Les points ci-dessous qui supposent une liste `tools` commune sont caducs.

- **L'ordre du préfixe compte** : tools, puis system, puis messages. Pour que les 4 appels dérivés partagent le même préfixe :
  1. **la liste `tools` est identique** dans les 4 appels, avec les 4 outils `emit_*` ;
  2. le script, le brief et le preset sont placés **dans `system`**, avec `cache_control` sur le dernier bloc ;
  3. l'instruction propre à l'asset va dans le message utilisateur final.

  Raison : un changement de `tool_choice` invalide le cache des blocs *messages*, pas celui de tools/system. Ce comportement est documenté, mais à revérifier sur la version d'API utilisée au moment de l'implémentation.
- Le cache est **propre à chaque modèle**. Le cache écrit pendant l'appel script (Opus) ne sert pas aux appels Haiku. Pour le script, on cache le bloc d'instructions statiques et le preset de chaîne, ce qui profite aux régénérations du script.
- TTL de 5 min par défaut, suffisant pour la phase de dérivés (moins d'une minute). Le TTL d'1 h est à évaluer pour les sessions d'édition et de régénération, où l'écriture coûte plus cher mais les relectures sont fréquentes.
- Il existe un seuil minimal de tokens cacheables, plus élevé sur Haiku. Un script de 2 min peut passer sous ce seuil : c'est acceptable, l'enjeu de coût est faible dans ce cas.
- Mesure : `cache_read_tokens / (input + cache_read + cache_creation)` par type d'asset, avec un objectif de plus de 60 % sur seo, voiceover et thumbnails.

### 4.8 Modèles et tarifs, centralisés

```ts
// lib/ai/models.ts : surchargeable par env, aucun identifiant en dur ailleurs
export const MODELS: Record<ModelKey, string> = {
  'script.premium': env.MODEL_SCRIPT_PREMIUM ?? 'claude-opus-5-5',
  'script.standard': env.MODEL_SCRIPT_STANDARD,     // Sonnet génération courante
  light: env.MODEL_LIGHT ?? 'claude-haiku-5-5',
};
// lib/ai/pricing.ts : USD par million de tokens, à renseigner depuis la grille Anthropic en vigueur
export const PRICING: Record<string, { in: number; out: number; cacheWrite: number; cacheRead: number }> = { /* ... */ };
export const costMicros = (m: string, u: Usage) => /* Σ tokens × prix */ 0;
```

---

## 5. Facturation

### 5.1 Coût en crédits (hypothèses à calibrer)

Le calibrage se fait sur `generations.cost_usd_micros`, avec pour objectif un coût marchandise inférieur ou égal à un tiers de la valeur d'un crédit.

| Asset | Crédits |
|---|---|
| script standard | 4 + 1 par minute de durée |
| script premium (Opus) | 8 + 2 par minute |
| titles | 1 |
| seo | 2 |
| voiceover | 2 + 1 par tranche de 10 min |
| thumbnails | 1 |
| Régénération | Même coût que l'asset |
| Édition manuelle, restauration | 0 |

Exemple : un pipeline standard de 10 min coûte 14 + 1 + 2 + 3 + 1 = **21 crédits**.

Plans (exemples) : Free 30 crédits uniques, Creator 400 par mois, Pro 1 500 par mois, Studio 5 000 par mois avec 5 sièges et l'accès Premium. Packs ponctuels : 200 et 1 000 crédits, sans expiration. Pour le MVP, le report des crédits d'abonnement est **plafonné à 1× l'allocation mensuelle**, via une écriture `expire` au renouvellement. Les buckets séparés abonnement/achat sont reportés en v2 (ADR-004).

```ts
// lib/billing/costs.ts
export const pipelineCost = (b: Brief, tier: Tier) =>
  DAG_ORDER.reduce((sum, t) => sum + registry[t].credits(b, tier), 0);
```

### 5.2 Flux réservation, capture, libération

1. `createPipeline` : on valide le brief et on applique le rate limit. Si l'abonnement est `past_due`, la création est bloquée. On appelle ensuite `credit_op(ws,'reserve', total, 'reserve:pipe:<id>')`, puis on insère le pipeline et les assets `pending`, dans une seule RPC transactionnelle `create_pipeline_with_reservation`. En cas de crédits insuffisants, on renvoie une erreur typée qui ouvre un modal d'upgrade.
2. Chaque asset réussi déclenche `capture`, avec le montant de l'asset et la clé `capture:pipe:<id>:<type>`, **dans la même transaction** que l'insertion de version.
3. `finalize` ou `onFailure` : `release` du reliquat, `credits_reserved − Σ captures`, avec la clé `release:pipe:<id>`.
4. Un balayage `cron` Inngest toutes les 15 min libère les réservations des pipelines `running` depuis plus de 30 min. C'est le filet de sécurité si Inngest tombe.

La double facturation est impossible à trois niveaux : la contrainte `unique(idempotency_key)` du registre, le verrou `FOR UPDATE` et l'idempotence Inngest.

> **Révision (octobre 2026, tâche 3.1).** Migration `20261025000006_reservation.sql`.
>
> **`credit_op`** relit la clé d'idempotence **après** le verrou. Sinon, deux appels simultanés avec la même clé passaient tous deux le premier contrôle, et le second échouait sur l'unicité.
>
> **`create_pipeline_with_reservation`** est idempotente par `(workspace, idempotency_key)` : la clé est une par soumission du formulaire. Elle renvoie `(pipeline_id, created)`.
> - Un double clic renvoie le pipeline existant avec `created = false`, sans nouvelle réservation.
> - Elle revérifie le rôle `editor` et l'appartenance du preset au workspace, puisqu'en service role `auth.uid()` est vide.
> - Un solde insuffisant lève `INSUFFICIENT_CREDITS` (`P0001`) avec un détail `{required, available}`. Rien n'est créé, et la clé reste libre pour une nouvelle tentative.
>
> **Côté TypeScript** :
> - `src/lib/billing/costs.ts` (`assetCredits`, `pipelineCredits`) calcule les coûts à partir du registre ;
> - `src/lib/billing/reservation.ts` traduit l'erreur en `InsufficientCreditsError`.
>
> **Test de concurrence** (`tests/integration/credits.test.ts`). Pour rendre le chevauchement déterministe :
> 1. une connexion verrouille le compte ;
> 2. elle attend que les 10 réservations soient bloquées, ce qui est visible dans `pg_stat_activity` ;
> 3. elle relâche le verrou.
>
> Sans `FOR UPDATE`, les 10 réservations réussissent et le test échoue, ce qui a été vérifié par mutation.
>
> **Reste à brancher** dans la Server Action `createPipeline`, quand l'authentification et les workspaces seront là (phase 2).

> **Révision (octobre 2026, tâche 3.2).** Migration `20261025000007_capture_release.sql`.
>
> **Capture.** `commit_asset_version` capture `generations.credits` avec la clé `capture:pipe:<id>:<type>`, dans la même transaction que la version.
> - Le montant est plafonné au reliquat réservé (`private.pipeline_reservation_remaining`). Une génération qui se termine après une annulation est donc enregistrée sans être facturée, au lieu de faire échouer le `CHECK reserved >= 0`.
> - Aucune capture n'a lieu sans réservation. Les régénérations (`regen:<nonce>`) sont facturées depuis la tâche 4.2 (migration 0012).
>
> **Libération.** `finalize_pipeline` pose le statut terminal et libère le reliquat avec la clé `release:pipe:<id>`. Elle est idempotente.
> - `SupabasePipelineStore.setPipelineStatus` l'appelle pour tout statut terminal : fin du DAG, `onFailure` et annulation.
> - Un échec du script libère 100 % de la réservation. Un pipeline `partial` libère l'asset échoué et ses dépendants sautés.
>
> **Verrous.** L'ordre est le même partout : la ligne `pipelines`, puis `credit_accounts`. Une capture et une finalisation simultanées se suivent donc sans interblocage.
>
> **Balayage.** `sweep_stale_reservations` tourne en cron Inngest (`sweep-reservations`, toutes les 15 min).
> - Il passe en échec les pipelines `queued` ou `running` **sans activité** depuis 30 min, et libère leur réservation.
> - L'activité tient compte de la dernière prise ou fin de génération, pour épargner un pipeline lent ou en file d'attente.

> **Révision (octobre 2026, tâche 3.5).** Le coût est affiché avant chaque action payante.
>
> **Une seule grille.** `src/lib/billing/credit-rules.ts` (`CREDIT_RULES`) est un module pur. Le registre l'utilise pour facturer, et l'interface pour afficher les coûts : le formulaire, les boutons « Régénérer » et la page des tarifs. Ainsi `costs.ts` ne tire plus le registre, ni donc les prompts, dans le bundle client.
>
> **Catalogue.** `src/lib/billing/plans.ts` liste les plans et les packs de ce paragraphe, avec leurs limites affichées : durée maximale, Premium, presets, sièges.
> - Les **prix sont provisoires** (19, 49 et 149 € par mois ; packs à 15 et 59 €), en attendant la décision sur la grille et la devise (PLAN §8, question 1).
> - Les limites sont appliquées côté serveur à la tâche 3.6.
>
> **Solde.** `getCreditSummary` (`src/lib/billing/balance.ts`) lit `plan_key` et `credit_accounts` sous RLS. Le disponible vaut `balance − reserved`.
>
> **Interface.**
> - Un badge de solde dans l'en-tête mène à `/pricing`.
> - Le formulaire du brief affiche une estimation en direct (total, détail par asset, solde restant).
> - Le modal « crédits insuffisants » s'ouvre sur la réponse `insufficient: {required, available}` de la Server Action, et la saisie est conservée.
>
> **Mode démo.** En attendant l'authentification (phase 2), le solde vient de `src/lib/demo/credits.ts` (Free, 20 crédits disponibles depuis la tâche 3.6). La Server Action compare le coût à ce solde ; elle s'appuiera ensuite sur l'`InsufficientCreditsError` de la réservation.

> **Révision (octobre 2026, tâche 3.6).** Migration `20261025000008_plan_limits.sql`. Les restrictions par plan sont vérifiées à deux niveaux :
> 1. la Server Action, pour un message immédiat (`pipelineRestriction`, `src/lib/billing/entitlements.ts`) ;
> 2. la base, qui refuse avec `PLAN_RESTRICTED` (`42501`) et un détail `{reason, plan, limit?}`. Côté TypeScript, ce refus devient une `PlanRestrictionError` : statut 403, avec un message qui dit quoi faire.
>
> **Création d'un pipeline.** `create_pipeline_with_reservation` refuse, dans l'ordre et avant toute écriture :
> - un abonnement `past_due` ou `unpaid` : les nouveaux pipelines sont bloqués, la lecture est conservée ;
> - une durée au-delà du plan (Free : 10 min) ;
> - le palier Premium hors Studio.
>
> Une clé d'idempotence déjà acceptée renvoie toujours son pipeline, même après un changement de plan.
>
> **Presets de chaîne.** Les membres les créent directement (policy `ch_write`), donc la limite est un trigger `before insert`.
> - Le trigger verrouille la ligne du workspace, ce qui sérialise deux créations simultanées.
> - Il passe avant la RLS. Un non-éditeur est donc laissé au refus de la RLS : le trigger ne lit pas le plan d'un autre workspace et ne verrouille pas sa ligne.
>
> **Limites.** `private.plan_limits` reproduit `PLANS` ; un test d'intégration vérifie la parité. Un plan inconnu reçoit les limites de Free.
>
> **Faille corrigée.** La policy `ws_admin` permettait à un admin de réécrire `plan_key` et `stripe_customer_id` : il pouvait se passer lui-même en Studio. L'`UPDATE` client est désormais limité aux colonnes `name` et `slug`.
>
> **Interface.**
> - Le champ durée est borné et annonce la limite du plan.
> - L'option Premium est grisée hors Studio.
> - Un refus s'affiche en alerte, avec un lien vers les tarifs.
>
> **Tests de mutation.** Les tests de `tests/integration/plan-limits.test.ts` détectent trois régressions :
> - un trigger sans verrou (le test de concurrence est rendu déterministe par une transaction tenue ouverte) ;
> - un trigger sans garde RLS ;
> - un `UPDATE` complet sur `workspaces`.
>
> **Tests.** `tests/integration/billing-flow.test.ts` fait tourner la vraie orchestration sur le vrai store, avec un client Anthropic hors réseau. La suppression de la capture et la suppression du plafond ont été testées par mutation : elles font échouer les tests.

### 5.3 Webhooks Stripe

```ts
// app/api/webhooks/stripe/route.ts
export async function POST(req: Request) {
  const body = await req.text();                                       // corps brut obligatoire
  const evt = stripe.webhooks.constructEvent(body, req.headers.get('stripe-signature')!, env.STRIPE_WEBHOOK_SECRET);
  const { error } = await admin.from('stripe_events').insert({ id: evt.id, type: evt.type });
  if (error?.code === '23505') return new Response('dup', { status: 200 });   // déjà reçu
  await inngest.send({ name: 'stripe/event', id: evt.id, data: { id: evt.id } }); // traitement durable
  return new Response('ok');
}
```

Le traitement passe par la fonction `stripe-sync`. Elle relit l'objet par l'API Stripe, plutôt que de faire confiance au payload, ce qui protège contre l'arrivée des événements dans le désordre.

| Événement | Action |
|---|---|
| `checkout.session.completed` (subscription) | Lier `stripe_customer_id` au workspace. Les métadonnées `workspace_id` sont posées à la création de la session côté serveur. |
| `checkout.session.completed` (payment, pack) | `purchase`, clé `stripe:cs:<id>` |
| `invoice.paid` (`subscription_create` / `subscription_cycle`) | `expire` du reliquat au-delà du plafond, puis `grant` de l'allocation, clé `stripe:inv:<id>` |
| `customer.subscription.created/updated/deleted` | Upsert `subscriptions` et `workspaces.plan_key`. Un upgrade en cours de période donne un `grant` différentiel au prorata, clé `stripe:upg:<sub>:<period>`. |
| `invoice.payment_failed` | `past_due` : nouveaux pipelines bloqués, lecture conservée |
| `charge.refunded` | `adjust`, plafonné au solde disponible (`balance ≥ reserved`), alerte admin si un écart subsiste |

Les changements de plan passent par le Stripe Customer Portal, sans UI de gestion maison.

> **Révision (octobre 2026, tâches 3.3 et 3.4).**
> - **Catalogue** : chaque offre payante de `src/lib/billing/plans.ts` porte une clé de recherche Stripe (`lookupKey`). `pnpm stripe:seed` (`scripts/stripe-seed.mts`) crée produits et prix ; Checkout retrouve le prix par sa clé, la synchronisation retrouve l'offre par la clé du prix. Aucun identifiant `price_…` dans le code.
> - **Achat** (`/w/[workspaceSlug]/billing`, raccourci `/billing`, admins seulement) : `createCheckoutSession` crée au besoin le client Stripe du workspace (clé d'idempotence `customer:<workspace>`), puis une session avec `metadata.workspace_id` (et sur l'abonnement ou le paiement). Retour sur `/w/<slug>/billing?success=1`. Un workspace déjà abonné passe par le portail. Les crédits n'arrivent que par le webhook.
> - **Webhook** (`/api/webhooks/stripe`) : signature vérifiée, `stripe_events` en déduplication, transmission à Inngest avec l'id Stripe comme id d'événement. Si l'envoi échoue, la ligne est retirée et Stripe renverra l'événement (500). Les types non traités sont enregistrés comme traités.
> - **`stripe-sync`** (`src/lib/billing/stripe-sync.ts`) relit l'événement, puis l'objet, chez Stripe. Écritures par les RPC service role de la migration 0011, toutes idempotentes :
>   - `stripe_apply_subscription` : upsert de l'abonnement et plan du workspace (celui d'un abonnement `active`, `trialing` ou `past_due`, Free sinon) ;
>   - `stripe_renew` (facture `subscription_create` ou `subscription_cycle` payée) : `expire` du disponible au-delà d'une allocation, puis `grant`, clés `stripe:inv:<id>[:expire]` ;
>   - `stripe_credit` : pack (`purchase`, `stripe:cs:<session>`, référence du paiement), upgrade au prorata du temps restant (`stripe:upg:<sub>:<début de période>:<plan>`), remboursement de pack (`adjust` de la part remboursée, `stripe:refund:<charge>:<montant remboursé>`).
>   - Un remboursement d'abonnement n'est pas rapproché automatiquement (`ignored:unmatched`) : il relève de la réconciliation (tâche 4.6).
> - **Suppression du compte** : `stripeCanceler` résilie immédiatement les abonnements quand Stripe est configuré.
> - **Tests** : fixtures d'événements et lecteur Stripe en mémoire (`tests/fixtures/stripe.ts`) contre la vraie base (`tests/integration/stripe-sync.test.ts`, rejeu et désordre compris) ; signatures générées par le SDK pour la route (`tests/unit/app/stripe-webhook.test.ts`). La suppression de l'idempotence d'un pack et du prorata de l'upgrade a été testée par mutation.

---

## 6. Sécurité

**Rate limiting** (`@upstash/ratelimit`, fenêtre glissante) :

| Cible | Limite |
|---|---|
| `createPipeline` | 10 par heure et par utilisateur, 30 par heure et par workspace |
| `regenerateAsset` | 30 par heure et par utilisateur |
| Connexion / magic link | 5 par 15 min par IP et par e-mail |
| Export | 60 par heure |

À cela s'ajoutent la concurrence Inngest par workspace (2) et un **disjoncteur de dépense** (`spend-guard.ts`). Celui-ci additionne la dépense du jour dans Redis à partir de `cost_usd_micros`. Au-delà d'un seuil global, les nouveaux pipelines sont mis en pause et une alerte part. Au-delà d'un seuil par workspace, on soupçonne un compte compromis ou un abus.

**Injection de prompt :**
- Surface d'entrée : le brief, le preset de chaîne (partagé entre membres), le feedback de régénération et, plus tard, d'éventuelles transcriptions de vidéos concurrentes, à risque élevé. Le risque principal n'est pas une exfiltration : il n'y a ni outil à effet de bord, ni données d'autres tenants dans le contexte. Il porte sur le détournement de la sortie : contenu interdit, sabotage d'un preset partagé, fuite du prompt système.
- Mesures :
  1. contenu non fiable encadré par `renderUntrusted()` (balises XML, échappement de `<`, `>` et `&`), avec une consigne système de traiter ces blocs comme des données ;
  2. limites de longueur strictes (Zod) ;
  3. le modèle n'a **aucun outil réel**, seulement des outils `emit_*` de format ;
  4. sortie validée par Zod et jamais exécutée ;
  5. rendu React en texte, sans `dangerouslySetInnerHTML`. L'export Markdown est échappé.
- Le prompt système n'est pas secret au point d'être critique. On évite d'y mettre quoi que ce soit de sensible.
- Modération : listes de niches refusées (désinformation médicale, contenu sexuel, extrémisme), vérification légère par Haiku sur le brief seulement si un mot-clé est détecté, et `factCheckFlags` affichés à l'utilisateur.

**Secrets :**
- `env.ts` valide toutes les variables par Zod au démarrage.
- `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `INNGEST_SIGNING_KEY` et `UPSTASH_*` ne sont **jamais** préfixées `NEXT_PUBLIC_`.
- `lib/supabase/admin.ts` commence par `import 'server-only'`.
- Clés séparées par environnement (preview, prod). Les déploiements de preview utilisent une clé Anthropic au plafond de dépense bas.
- Rotation documentée.

**RLS et autorisation :**
- RLS activée sur 100 % des tables. Un test CI interroge `pg_tables` et échoue si une table n'a pas de RLS.
- Toute écriture sensible (pipelines, versions, crédits) passe par le service role **après** une vérification explicite de `has_role` dans la Server Action. On a ainsi deux couches.
- Les Server Actions revalident l'appartenance : un id de workspace venant du client n'est jamais cru tel quel.
- Fonctions `security definer` avec `search_path = ''`, `private.*` non exposé.
- Tests pgTAP ou d'intégration : un utilisateur B ne lit rien du workspace A, y compris sur les canaux Realtime.

**Divers :** CSP stricte, Server Actions avec contrôle d'origine natif Next, webhook Inngest signé, journal d'audit couvert par le registre et les versions immuables (`created_by`).

---

## 7. ADR

**ADR-001 : Inngest comme orchestrateur.** *Accepté.*
- Contexte : un DAG de 5 à 6 étapes, un script de 1 à 4 min, des retries et une idempotence exigés.
- Options :
  - **Inngest** : étapes mémoïsées, `idempotency` et `concurrency` par clé, `cancelOn`, `onFailure`, intégration Vercel, dev server local.
  - **Trigger.dev** : exécution sur son infrastructure, sans timeout Vercel, avec des streams temps réel intégrés. En contrepartie, une infrastructure de calcul de plus, et des déploiements découplés du code Next.
  - **QStash / Upstash Workflow** : simple et bon marché, mais un contrôle de la concurrence par clé et une observabilité moins riches.
  - **pgmq + Edge Functions Supabase** : pas de fournisseur supplémentaire, mais tout est à reconstruire (retries, DAG, tableau de bord), avec des limites de durée propres.
- Conséquences :
  - (−) chaque étape reste soumise à `maxDuration` Vercel. Le mode plan puis sections est nécessaire au-delà de 30 min de vidéo.
  - (−) dépendance à un fournisseur. Elle est contenue par le fait que `lib/pipeline` est indépendant d'Inngest : passer à Trigger.dev ne change que `lib/jobs`.

**ADR-002 : Tool use forcé + Zod + une réparation.** *Remplacé (octobre 2026).*
- Révision : `tool_choice` `tool`/`any` renvoie une 400 sur Claude Opus 5.5 et Claude Sonnet 5.5. On utilise les sorties structurées natives (`output_config.format`, JSON Schema dérivé de Zod par `zodOutputFormat`). Le JSON arrive en deltas de texte, et l'API ignore les bornes (`minLength`, `maximum`…) que le SDK retire du schéma : la validation Zod côté serveur et la réparation restent obligatoires. Voir `src/lib/ai/structured.ts`.
- Décision d'origine, conservée pour l'historique :
- Pour : schéma unique en Zod vers JSON Schema, streaming partiel avec `input_json_delta`, validation métier (`refine`) impossible à exprimer en JSON Schema.
- Contre : incompatible avec l'extended thinking.
- Alternatives :
  - structured outputs natifs, à basculer si on veut du thinking sur le script ;
  - Vercel AI SDK `streamObject` : DX agréable, mais une couche de plus entre le code et les paramètres de cache et de bêta Anthropic. Écarté pour `lib/ai`.

**ADR-003 : Streaming via Supabase Realtime Broadcast, DB comme source de vérité.** *Accepté.*
- Le worker n'a pas de connexion HTTP vers le client. Le SSE depuis un Route Handler obligerait à générer dans la requête, donc à abandonner la durabilité.
- Broadcast privé avec RLS sur `realtime.messages`. Aucune garantie de livraison, ce qui est compensé par la relecture DB.
- Alternative : les streams temps réel de Trigger.dev, si ADR-001 change.

**ADR-004 : Registre de crédits Postgres réservation/capture/libération, avec un solde unique et un report plafonné.** *Accepté.*
- Pour : atomicité transactionnelle avec l'insertion de version, coût réel par asset, remboursement partiel naturel en cas de pipeline `partial`.
- Contre : la logique est à maintenir, et la réconciliation Stripe est manuelle (job hebdomadaire).
- Alternatives : Stripe metered billing ou credit grants. Écartés pour la latence, l'absence de réservation et la vérification de solde synchrone impossible. Buckets abonnement/achat séparés : reportés en v2.

**ADR-005 : Versions d'assets immuables + pointeur `current_version_id` + `source_script_version_id`.** *Accepté.*
- Pour : historique, restauration, détection d'obsolescence, reproductibilité (`prompt_version`, `schema_version`, `channel_snapshot`).
- Contre : volume en JSONB. C'est négligeable (moins de 50 Ko par version) et purgeable au-delà de N versions.

**ADR-006 : Prompts versionnés dans le code (git), pas en DB.** *Accepté.*
- Pour : revue en PR, évaluations en CI (`evals/` avec briefs de référence, juge LLM sur une grille, seuil de régression), typage.
- Contre : il faut déployer pour itérer. Les variantes A/B passent par feature flag.

**ADR-007 : Choix du modèle par plan.** *Accepté, à réévaluer avec les évaluations.*
- Le script dans la génération Sonnet courante par défaut, Opus en Premium, Haiku pour les dérivés.
- Le script représente l'essentiel du coût. Opus partout réduirait la marge ou ferait monter le prix du crédit sans gain mesuré.

**ADR-008 : Calculs déterministes hors LLM** (timings, chapitres, limites YouTube). *Accepté.* Le LLM décide du découpage sémantique, le code fait l'arithmétique et applique les règles de la plateforme.

**ADR-009 : supabase-js + migrations SQL plutôt que Drizzle ou Prisma.** *Accepté.* La RLS, les RPC et le Realtime sont natifs, et les types sont générés. Drizzle reste possible pour des requêtes analytiques complexes plus tard.

### Observabilité

- **Par appel** (`generations`) : modèle, `prompt_version`, tokens input/output/cache_creation/cache_read, `cost_usd_micros`, `latency_ms`, `ttft_ms`, `validation_repairs`, `attempt`, `error_code`, `inngest_run_id`.
- **Vue de coût et de marge :**

```sql
create view private.v_pipeline_economics as
select p.id, p.workspace_id, p.model_tier, (p.brief->>'durationMinutes')::int as minutes,
       sum(g.cost_usd_micros)/1e6 as cost_usd,
       sum(g.credits) filter (where g.status='succeeded') as credits_captured,
       sum(g.cache_read_tokens)::float / nullif(sum(g.input_tokens+g.cache_read_tokens+g.cache_creation_tokens),0) as cache_hit_ratio,
       sum(g.latency_ms) as total_latency_ms
from pipelines p join generations g on g.pipeline_id = p.id group by p.id;
```

- **Indicateurs suivis :** coût par crédit (marge brute), p95 de latence par étape, taux d'échec Zod par `prompt_version`, taux de réparation, ratio de cache, taux de pipelines `partial`, durée réelle comparée à la durée cible.
- **Outils :**
  - Sentry (front et serveur), avec `pipelineId` et `workspaceId` en tags ;
  - logs pino structurés, corrélés par `pipelineId` et `generationId` ;
  - tableau de bord Inngest pour les exécutions et les relances ;
  - optionnel : Langfuse ou un export OpenTelemetry pour les traces de prompts, **avec masquage** du brief si on en fait une option de confidentialité.
- **Alertes :**
  - pipeline à plus de 3× le coût médian de sa catégorie ;
  - taux d'échec supérieur à 5 % sur 15 min ;
  - réservations orphelines ;
  - disjoncteur de dépense déclenché ;
  - écart de réconciliation Stripe/registre.

> **Révision (octobre 2026, tâche 0.8).** La mise en place des comptes (Vercel, Supabase staging, Inngest Cloud, Sentry) est décrite dans [DEPLOYMENT.md](DEPLOYMENT.md). Sentry (`@sentry/nextjs` 11) est initialisé dans `src/instrumentation.ts` et `src/instrumentation-client.ts`, à partir de `src/lib/observability/sentry.ts` ; il reste inactif sans `NEXT_PUBLIC_SENTRY_DSN`. Les erreurs des jobs passent par `@inngest/middleware-sentry`, étapes comprises, à la dernière tentative. Pas de Session Replay ni de données personnelles. Les tags `pipelineId` et `workspaceId` restent à poser avec les Server Actions (phase 2). Sur Vercel, le build échoue sans `INNGEST_SIGNING_KEY` et `INNGEST_EVENT_KEY`.

### Ordre de mise en œuvre suggéré

1. Migrations, RLS et tests d'isolation.
2. `lib/ai` (`callStructured`) et schémas, plus évaluations sur 10 briefs.
3. `generateAsset` et le DAG Inngest, sans facturation.
4. Streaming Broadcast et UI.
5. Registre de crédits, Stripe et webhooks.
6. Régénération, versions et obsolescence.
7. Rate limits, disjoncteur de dépense, tableaux de bord de coût.

### Points à vérifier pendant l'implémentation

- Les identifiants de modèle (`claude-opus-5-5`, `claude-haiku-5-5`) et l'ID Sonnet viennent de ta stack ou sont laissés vides dans le document. Ils restent configurables par env dans `lib/ai/models.ts`.
- La grille tarifaire en tokens est laissée vide, à remplir depuis la tarification Anthropic en vigueur.
- Deux points sont à confirmer dans la documentation API au moment de coder :
  - le paramètre exact des structured outputs natifs et du mode `strict` sur les outils ;
  - le fait qu'un changement de `tool_choice` invalide uniquement le cache des blocs messages. Le partage du cache entre assets dérivés repose sur ce point.
