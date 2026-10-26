# Runbook : mise en production et incidents (tâche 5.5)

Deux parties : la **checklist de mise en production**, à cocher une fois pour toutes avant d'ouvrir le service, et la **conduite à tenir** pour chaque incident connu. Les comptes et les clés de production sont créés et détenus par le porteur du projet ; rien ici ne se fait à sa place. Les previews et le staging sont décrits dans [DEPLOYMENT.md](DEPLOYMENT.md).

`pnpm preflight <fichier d'env>` vérifie les points bloquants qui se lisent dans l'environnement (voir §1.9). Il n'affiche que des noms de variables, jamais de valeur.

---

## 1. Checklist de mise en production

Chaque point a sa vérification. Cocher seulement ce qui a été vérifié.

### 1.1 Supabase (projet de production)

- [ ] Projet de production distinct du staging, sur un plan qui inclut les sauvegardes (Pro au minimum).
- [ ] **PITR** activé : Database → Backups → Point in Time Recovery. *Vérifier* : la page indique la fenêtre de restauration disponible.
- [ ] Migrations appliquées : `pnpm exec supabase link --project-ref <ref>`, `pnpm exec supabase db push --dry-run`, puis `db push`. *Vérifier* : `--dry-run` n'annonce plus rien.
- [ ] Auth → URL Configuration : *Site URL* = le domaine de production ; *Redirect URLs* = `https://<domaine>/auth/callback` et `https://<domaine>/auth/confirm`.
- [ ] Auth → Email Templates → Magic Link : contenu de `supabase/templates/magic-link.html` (il pointe vers `/auth/confirm`, ce qui permet d'ouvrir le lien sur un autre appareil).
- [ ] **SMTP personnalisé** (Auth → SMTP Settings) : le SMTP intégré de Supabase n'envoie que quelques e-mails par heure, trop peu pour de vraies inscriptions. *Vérifier* : un lien magique arrive depuis l'expéditeur du domaine.
- [ ] Google (facultatif) : fournisseur configuré avec l'URL de rappel Supabase, puis `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true`.
- [ ] Région du projet reportée dans `LEGAL_ENTITY.databaseRegion` (`src/lib/legal.ts`).

### 1.2 Anthropic

- [ ] Clé API dédiée à la production, dans un workspace Anthropic à part (Console → Workspaces).
- [ ] **Plafond de dépense mensuel** sur ce workspace (Console → Limits). C'est le dernier filet : le disjoncteur de l'application (§1.6) doit se déclencher avant lui.
- [ ] Palier de rate limit suffisant pour la concurrence prévue (au plus 50 pipelines en parallèle, 2 par workspace : `run-pipeline`).
- [ ] *Vérifier* : un pipeline d'exemple (onboarding) se génère de bout en bout avec cette clé.

### 1.3 Stripe en live

- [ ] Compte activé pour les paiements live (identité, IBAN). Question de la TVA tranchée (Stripe Tax, ou prix TTC).
- [ ] Catalogue live : `STRIPE_SECRET_KEY=sk_live_… STRIPE_SEED_LIVE=1 pnpm stripe:seed`. *Vérifier* : les produits `pipeline_*` et leurs prix apparaissent en mode live.
- [ ] Customer Portal configuré **en mode live** (il est distinct du mode test) : moyen de paiement, factures, résiliation, changement de plan au prorata.
- [ ] Webhook live vers `https://<domaine>/api/webhooks/stripe`, avec les 8 événements listés dans [DEPLOYMENT.md](DEPLOYMENT.md) (§4 bis), et son secret dans `STRIPE_WEBHOOK_SECRET`.
- [ ] Paramètres → Public : URL des CGU (`/cgu`) et de la confidentialité (`/confidentialite`). Puis `STRIPE_TERMS_CONSENT=required` : la case à cocher des CGU apparaît dans Checkout (sans l'URL des CGU, Stripe refuserait la session).
- [ ] La clé de test exposée pendant le développement a été **roulée** (Développeurs → Clés API → Rouler la clé).
- [ ] *Vérifier* : achat réel du plus petit pack, crédits ajoutés après le webhook, puis remboursement depuis Stripe : les crédits sont retirés (`charge.refunded`).

### 1.4 Inngest

- [ ] Environnement de production synchronisé avec `https://<domaine>/api/inngest` : **5 fonctions** (`run-pipeline`, `regenerate-asset`, `sweep-reservations`, `stripe-sync`, `monitor-economics`).
- [ ] `INNGEST_SIGNING_KEY` et `INNGEST_EVENT_KEY` de production sur Vercel (posées par l'intégration).

### 1.5 Vercel

- [ ] Domaine de production attaché, HTTPS actif, et `NEXT_PUBLIC_SITE_URL=https://<domaine>`.
- [ ] Variables de l'environnement *Production* seulement : Supabase, Anthropic, Inngest, Stripe live, `STRIPE_TERMS_CONSENT`, `ADMIN_EMAILS`, `POSTHOG_KEY`, Sentry, seuils de dépense. Les previews gardent les clés de test : le build refuse une clé live sur une preview, et une clé de test en production.
- [ ] *Vérifier* : `vercel env pull .env.production.local --environment=production`, puis `pnpm preflight .env.production.local` sans `FAIL`. Supprimer le fichier ensuite (il est ignoré par git).

### 1.6 Garde-fous de dépense et d'abus

- [ ] `SPEND_DAILY_LIMIT_USD` et `SPEND_DAILY_WORKSPACE_LIMIT_USD` choisis (200 $ et 25 $ par défaut), sous le plafond mensuel Anthropic ramené à la journée.
- [ ] Liste des mots-clés de modération relue (`src/lib/security/moderation.ts`).

### 1.7 Observabilité

- [ ] `NEXT_PUBLIC_SENTRY_DSN` de production ; source maps (`SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`).
- [ ] Règles d'alerte Sentry (e-mail ou Slack) sur les tags `alert:spend_guard`, `alert:costOutlier`, `alert:failureRate`, `alert:staleReservations`.
- [ ] `ADMIN_EMAILS` : `/admin` s'ouvre pour ces adresses et répond 404 aux autres.
- [ ] PostHog : projet en région UE, `POSTHOG_KEY`, insight Funnel `signed_up` → `pipeline_created` → `payment_completed` (fenêtre de 30 jours).

### 1.8 Documents légaux

- [ ] `LEGAL_ENTITY` complété (`src/lib/legal.ts`) : plus aucun « [à compléter] » ni bandeau « document provisoire » sur `/cgu`, `/confidentialite`, `/charte`, `/mentions-legales`.
- [ ] Textes relus par un juriste (rétractation, transferts hors UE, médiateur).

### 1.9 Validation finale

- [ ] `pnpm preflight .env.production.local` : « Prêt pour la mise en production. »
- [ ] Parcours réel en production : inscription par lien magique → brief d'exemple → pipeline terminé en moins de 2 min → export ZIP → achat d'un pack → remboursement.
- [ ] Événements visibles dans PostHog, coût et marge du pipeline visibles dans `/admin`.

---

## 2. Incidents

Pour chaque incident : le signal, le diagnostic, l'action. Les requêtes SQL se lancent dans l'éditeur SQL de Supabase.

### 2.1 Disjoncteur de dépense déclenché

**Signal** : alerte Sentry `alert:spend_guard` ; les utilisateurs voient « La génération est momentanément suspendue ».
**Diagnostic** : `/admin`. `scope=global` : la dépense du jour dépasse `SPEND_DAILY_LIMIT_USD`. `scope=workspace` : un seul workspace dépasse son seuil, peut-être un compte compromis ou un abus.

```sql
select workspace_id, sum(cost_usd_micros) / 1e6 as usd
from generations
where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
group by 1 order by 2 desc limit 10;
```

**Action** : usage légitime, relever le seuil (variable Vercel, puis redéploiement) ou attendre minuit UTC. Abus : bannir l'utilisateur (Supabase → Authentication → Users), puis vérifier ses workspaces.

### 2.2 Suspendre toutes les générations (coupe-circuit)

Panne prolongée d'Anthropic, coût qui s'emballe, faille suspectée : `SPEND_DAILY_LIMIT_USD=0.01` sur Vercel, puis redéploiement. Toute création et toute régénération est refusée sans débit, avec un message explicite ; les pipelines en cours se terminent. Rétablir la valeur pour reprendre.

### 2.3 Panne ou surcharge d'Anthropic (429, 529, 5xx)

**Signal** : alerte `alert:failureRate` (plus de 5 % d'échecs sur 15 min), erreurs `PROVIDER_ERROR` dans Sentry, status.anthropic.com.
**Ce qui se passe seul** : Inngest relance chaque étape avec backoff. Un asset qui échoue définitivement est rendu au workspace (réservation libérée) ; le pipeline finit `partial` ou `failed`.
**Action** : surcharge brève, rien. Panne longue, coupe-circuit (§2.2) pour ne pas accumuler les échecs.

### 2.4 Taux d'échec élevé sans panne d'Anthropic

Souvent un défaut de prompt ou de schéma après un déploiement.

```sql
select asset_type, prompt_version, error_code, count(*)
from generations
where finished_at > now() - interval '1 hour' and status = 'failed'
group by 1, 2, 3 order by 4 desc;
```

**Action** : `SCHEMA_INVALID` concentré sur une `prompt_version` récente, revenir au déploiement précédent (§2.10).

### 2.5 Webhooks Stripe en échec

**Signal** : Stripe → Développeurs → Webhooks montre des échecs ; un paiement sans crédits.
**Diagnostic** : `select id, type, received_at, processed_at from stripe_events where processed_at is null order by received_at;` et les exécutions de `stripe-sync` dans Inngest.
**Action** : secret incorrect (la route répond 400 « Signature invalide », ou 503 sans secret), corriger `STRIPE_WEBHOOK_SECRET` puis redéployer ; erreur de traitement, corriger puis relancer depuis Inngest. Renvoyer un événement depuis Stripe est sans risque : le traitement est idempotent.

### 2.6 Réservations non libérées

**Signal** : alerte `alert:staleReservations` (réservations sans activité depuis plus d'une heure), crédits « réservés » qui ne reviennent pas.
**Diagnostic** : la fonction `sweep-reservations` tourne-t-elle toutes les 15 min dans Inngest ?
**Action** : relancer le balayage à la main : `select public.sweep_stale_reservations();` (renvoie le nombre de réservations libérées).

### 2.7 Coût anormal d'un pipeline

**Signal** : alerte `alert:costOutlier` (plus de 3 fois le coût médian par minute de sa formule).
**Diagnostic** : `/admin`, puis `select asset_type, attempt, api_calls, validation_repairs, cost_usd_micros from generations where pipeline_id = '<id>';`. Des réparations ou des relances sur `max_tokens` répétées signalent un défaut de prompt.
**Action** : ponctuel, rien. Répété, traiter comme §2.4.

### 2.8 Fuite d'une clé

Rouler la clé chez le fournisseur, la remplacer sur Vercel, redéployer, puis vérifier.

| Clé | Où la rouler |
|---|---|
| `SUPABASE_SECRET_KEY` | Supabase → Settings → API Keys |
| `ANTHROPIC_API_KEY` | Console Anthropic → API Keys (désactiver l'ancienne) |
| `STRIPE_SECRET_KEY` | Stripe → Développeurs → Clés API → Rouler |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → l'endpoint → Rouler le secret |
| `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY` | Inngest → Manage → Signing Key, Event Keys |
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → Auth Tokens |

Une clé publique (`NEXT_PUBLIC_*`, `POSTHOG_KEY`) n'est pas un secret, mais se roule de la même façon en cas d'abus.

### 2.9 Restauration de la base (PITR)

**Quand** : perte ou corruption de données (migration fautive, suppression).
**Action** : suspendre les générations (§2.2), puis Supabase → Database → Backups → Point in Time, à l'instant juste avant l'incident. La restauration remplace la base : prévenir les utilisateurs.
**Après** : les paiements reçus depuis l'instant choisi ne sont plus dans le registre. Renvoyer depuis Stripe (Développeurs → Événements) les événements postérieurs ; l'idempotence évite tout double crédit. Vérifier ensuite `/admin` et le solde de quelques workspaces.

### 2.10 Retour arrière d'un déploiement

Vercel → Deployments → Instant Rollback. Les migrations, elles, ne sont pas annulées : avant de revenir en arrière, vérifier que l'ancien code fonctionne avec le schéma actuel. Une migration à défaire passe par une nouvelle migration, jamais par la modification d'un fichier déjà appliqué.
