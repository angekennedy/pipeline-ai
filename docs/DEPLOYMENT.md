# Déploiement : previews, staging, observabilité (tâche 0.8)

Objectif : **un déploiement de preview par PR**, branché sur un Supabase de staging, avec Inngest Cloud pour les jobs et Sentry pour les erreurs.

Le code est prêt. Sans les comptes, tout reste inactif :
- Sentry ne s'initialise pas sans DSN ;
- le workflow `Staging DB` ne s'exécute pas sans projet configuré ;
- en local, Inngest passe par `INNGEST_DEV=1`.

Ce guide se suit dans l'ordre. Aucun secret ne va dans le dépôt : ils vont dans Vercel ou dans les secrets GitHub.

```
PR GitHub ──▶ Vercel (preview) ──▶ Supabase staging (base, auth, Realtime)
                  │      ▲
                  │      └── Inngest Cloud appelle /api/inngest (environnement de branche)
                  └────────▶ Sentry (erreurs serveur, navigateur et jobs)
main ──▶ GitHub Actions « Staging DB » ──▶ supabase db push sur le staging
```

## 1. Supabase : projet de staging

1. Crée un compte sur [supabase.com](https://supabase.com) (connexion GitHub possible).
2. **New project** : nom `pipeline-ai-staging`, région **West EU (Paris)** ou la plus proche de tes utilisateurs. Note le **mot de passe de la base** dans ton gestionnaire de mots de passe : il ne sera plus affiché.
3. Note ensuite les valeurs suivantes :
   - **Project ref** : l'identifiant dans l'URL du tableau de bord (`supabase.com/dashboard/project/<ref>`) ;
   - **Project URL**, dans Settings → API ;
   - **Publishable key** et **Secret key**, dans Settings → API Keys ;
   - **Access token**, dans Account → Access Tokens. C'est un jeton personnel : il sert à la CLI.
4. Applique les migrations une première fois depuis ta machine :
   ```sh
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <ref>
   pnpm exec supabase db push
   ```
   Ensuite, le workflow `Staging DB` le fait à chaque fusion dans `main` qui touche `supabase/migrations/`.
5. Dans GitHub, configure le dépôt :
   - **Settings → Environments → New environment**, nommé `staging`. Ajoute-lui deux **secrets** : `SUPABASE_ACCESS_TOKEN` et `SUPABASE_STAGING_DB_PASSWORD`.
   - **Settings → Secrets and variables → Actions → Variables** : ajoute la variable **de dépôt** `SUPABASE_STAGING_PROJECT_REF`, qui reçoit le ref.

   Le ref doit être une variable du dépôt et non de l'environnement : la condition du job est évaluée avant que l'environnement soit chargé.

6. **Connexion (tâche 2.1)**, dans Authentication. Le fichier `supabase/config.toml` ne règle que la pile locale : sur le projet hébergé, ces réglages se font dans le tableau de bord.
   - **URL Configuration** : **Site URL** reçoit l'URL de production. Ajoute dans **Redirect URLs** `https://<domaine>/auth/callback` et `https://*-<équipe>.vercel.app/auth/callback` (les previews).
   - **Emails → Templates** : dans **Magic Link** et **Confirm signup**, remplace le lien par
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`, comme dans `supabase/templates/magic-link.html`. Sans ce changement, le lien d'origine ne passe pas par `/auth/confirm` et la connexion échoue.
   - **SMTP** : le serveur d'envoi intégré à Supabase est limité à quelques e-mails par heure, et réservé aux tests. Avant la bêta, branche un SMTP (Resend, Postmark, etc.) dans Settings → Auth.
   - **Google** (facultatif) : crée un identifiant OAuth « Application Web » dans Google Cloud Console, avec comme URI de redirection `https://<ref>.supabase.co/auth/v1/callback`. Colle le Client ID et le secret dans Authentication → Providers → Google, puis pose `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true` sur Vercel pour afficher le bouton.

> Les previews partagent la base de staging. Une PR qui ajoute une migration est donc déployée avant que sa migration soit appliquée : la preview peut échouer sur ces écrans jusqu'à la fusion. Si cela devient gênant, Supabase Branching, payant, donne une base par PR.

## 2. Vercel : previews par PR

1. Crée un compte sur [vercel.com](https://vercel.com) avec ton compte GitHub.
   - Le plan **Hobby** est gratuit, mais réservé à un usage non commercial. Pour vendre le SaaS, il faudra le plan **Pro**.
   - Vérifie aussi la durée maximale des fonctions de ton plan : `/api/inngest` demande 300 s (`maxDuration`).
2. **Add New → Project** : importe `angekennedy/pipeline-ai`. Vercel détecte Next.js et pnpm. Le premier déploiement échouera tant que les clés Inngest (étape 3) manquent, et c'est voulu.
3. **Settings → Environment Variables**. Pose ces variables pour **Preview** et **Production**. Tant que la production n'existe pas, toutes deux pointent vers le staging.

   | Variable | Valeur |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL du staging |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key |
   | `SUPABASE_SECRET_KEY` | Secret key (sensible) |
   | `OPENAI_API_KEY` | Une clé dédiée au staging, dans un projet OpenAI avec une limite de dépense. |

4. **Settings → Deployment Protection** : les previews sont protégées par l'authentification Vercel, ce qui bloque aussi les appels d'Inngest. Active **Protection Bypass for Automation** ; l'intégration Inngest (étape 3) utilisera ce secret.
5. Dans **Settings → Git**, les previews par PR sont activées par défaut, et le bot Vercel commente chaque PR avec son URL.

## 3. Inngest Cloud : jobs

1. Crée un compte sur [inngest.com](https://www.inngest.com).
2. Dans **Settings → Integrations → Vercel**, connecte le projet `pipeline-ai`. L'intégration :
   - pose `INNGEST_SIGNING_KEY` et `INNGEST_EVENT_KEY` dans Vercel, pour Production et Preview ;
   - synchronise l'app sur `/api/inngest` à chaque déploiement ;
   - crée un **environnement de branche** par preview.
3. Si les previews sont protégées, renseigne le secret de bypass (étape 2.4) dans la configuration de l'intégration.
4. Relance le déploiement Vercel : il passe maintenant.

Sans ces deux clés, le build Vercel échoue volontairement (`src/lib/env/server.ts`), au lieu de déployer une app dont chaque job échouerait.

## 4. Sentry : erreurs

1. Crée un compte sur [sentry.io](https://sentry.io) et choisis la région de données **EU**.
2. **Create project** : plateforme **Next.js**, nom `pipeline-ai`.
3. Dans Vercel, pose ces variables pour Preview et Production :
   - `NEXT_PUBLIC_SENTRY_DSN` : le DSN, dans Project Settings → Client Keys ;
   - pour les source maps, à poser au build seulement : `SENTRY_ORG`, `SENTRY_PROJECT` et `SENTRY_AUTH_TOKEN`. Le token se crée dans Organization Settings → Auth Tokens. L'intégration Vercel de Sentry peut poser ces trois variables pour toi.

Côté code :
- les erreurs serveur passent par `onRequestError`, dans `src/instrumentation.ts` ;
- les erreurs navigateur passent par `instrumentation-client.ts`, `global-error.tsx` et les error boundaries ;
- les erreurs des jobs Inngest passent par `@inngest/middleware-sentry`, à la dernière tentative, étapes comprises.

Les réglages de confidentialité :
- aucune donnée personnelle n'est envoyée (`sendDefaultPii: false`) ;
- il n'y a pas de Session Replay, car il enregistrerait les briefs et les scripts.

## 4 bis. Stripe : paiements (tâches 3.3 et 3.4)

Tout se fait d'abord en **mode test** (bascule « Mode test » en haut du tableau de bord Stripe). La production en live est décrite dans le [runbook](runbook.md) (§1.3).

1. **Clés** (Développeurs → Clés API) : copie la clé secrète `sk_test_…` dans `.env.local` (`STRIPE_SECRET_KEY`) et dans Vercel (Preview). Ne la colle jamais ailleurs.
2. **Catalogue** : `pnpm stripe:seed`. Le script crée un produit par plan payant et par pack, et un prix en euros qui porte la clé de recherche de l'offre (`plan_creator_monthly`, `pack_200`…). Il est sans effet s'il est relancé ; un montant modifié dans `src/lib/billing/plans.ts` crée un nouveau prix et archive l'ancien.
3. **Customer Portal** (Paramètres → Facturation → Portail client) : active le portail, autorise la mise à jour du moyen de paiement, l'historique des factures, la résiliation, et le **changement de plan** entre les produits Creator, Pro et Studio (prorata activé).
4. **Webhook en local** : installe la Stripe CLI (`brew install stripe/stripe-cli/stripe`), puis `stripe login`. Pendant le développement :
   ```
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   La commande affiche un secret `whsec_…` : mets-le dans `.env.local` (`STRIPE_WEBHOOK_SECRET`) et redémarre le serveur. Un serveur Inngest local (`npx inngest-cli@latest dev`) doit tourner pour que `stripe-sync` traite les événements.
5. **Webhook déployé** (Développeurs → Webhooks → Ajouter un endpoint) : URL `https://<preview ou domaine>/api/webhooks/stripe`, événements `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`. Copie le secret de signature dans Vercel (`STRIPE_WEBHOOK_SECRET`).
6. **Vérifier** : sur `/billing`, choisis un plan et paie avec la carte de test `4242 4242 4242 4242` (date future, CVC quelconque). Le retour se fait sur `/w/<workspace>/billing?success=1`, et le plan et les crédits apparaissent après le traitement du webhook. `stripe trigger invoice.payment_failed` ou `stripe trigger charge.refunded` rejouent les autres cas.

## 5. Vérifier le critère d'acceptation

1. Ouvre une PR : le bot Vercel commente l'URL de la preview, et le déploiement est vert.
2. Dans Inngest, l'environnement de branche de la PR montre l'app synchronisée, avec 4 fonctions.
3. Sur la preview, la page d'accueil s'affiche. Une erreur provoquée apparaît dans Sentry avec l'environnement `preview`.
4. Après la fusion d'une PR qui touche `supabase/migrations/`, le workflow **Staging DB** passe au vert.

## Variables : récapitulatif

| Variable | Où | Requise |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Vercel | Oui (build) |
| `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY` | Vercel | Oui (build) |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `SHOTSTACK_API_KEY` (et `SHOTSTACK_ENV`, `ELEVENLABS_MODEL_ID`) | Vercel | Non : sans elles, la vidéo est indisponible |
| `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY` | Vercel (intégration Inngest) | Oui sur Vercel |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `.env.local`, Vercel | Oui sur Vercel ; sans elles en local, la facturation est indisponible |
| `NEXT_PUBLIC_SENTRY_DSN` | Vercel | Non : Sentry inactif sans DSN |
| `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED` | Vercel | Non : `true` affiche le bouton Google, une fois le fournisseur configuré dans Supabase |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Vercel (build) | Non : pas de source maps sans eux |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_STAGING_DB_PASSWORD` | GitHub, environnement `staging` (secrets) | Pour `Staging DB` |
| `SUPABASE_STAGING_PROJECT_REF` | GitHub, variable du dépôt | Active `Staging DB` |

Variables de production et checklist de lancement : [runbook.md](runbook.md).
