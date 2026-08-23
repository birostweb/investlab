# Mon Investisseur IA

Application privée de suivi et d'analyse d'investissements, auto-hébergée.
Thème sombre, IBM Plex Mono, aucune donnée envoyée à un tiers.

Deux façons de l'utiliser, avec **exactement les mêmes analyses** :

| | En ligne (VPS + Dokploy) | Hors ligne (fichier local) |
|---|---|---|
| Accès | ton domaine, depuis n'importe quel appareil | double-clic sur un fichier |
| Clés d'API | sur le serveur, jamais dans le navigateur | saisies dans l'app |
| Cours | rafraîchis **automatiquement** | bouton « Actualiser » |
| Données | sur ton VPS, synchronisées entre appareils | dans ce navigateur |
| Accès protégé | mot de passe | — |

---

## 1. Déploiement sur ton VPS avec Dokploy

### a. Obtenir les clés gratuites (une seule fois, ~3 min)

| Clé | Sert à | Où |
|---|---|---|
| **Twelve Data** | cours et historiques — *la plus utile* | [twelvedata.com/pricing](https://twelvedata.com/pricing) — 800 req/jour |
| **Finnhub** | fondamentaux des actions (PER, marges, dette) | [finnhub.io/register](https://finnhub.io/register) |
| **Alpha Vantage** | secours (facultatif) | [alphavantage.co](https://www.alphavantage.co/support/#api-key) |

Sans aucune clé, l'application fonctionne quand même : analyse de portefeuille,
allocation, rééquilibrage, plan, simulateur et immobilier. Seuls les cours et
les fondamentaux manquent — et l'agent te le dira plutôt que d'inventer.

### b. Mettre le code sur un dépôt Git

Dokploy déploie depuis un dépôt. Depuis ce dossier :

```bash
git init && git add -A && git commit -m "Mon Investisseur IA"
```

Puis crée un dépôt **privé** (GitHub, GitLab ou ton Gitea) et pousse-le.
Le `.gitignore` exclut déjà `.env` et `data/` : aucun secret ne partira.

### c. Créer l'application dans Dokploy

1. **Create → Application**, puis relie ton dépôt Git.
2. **Build Type : Dockerfile** (il est à la racine).
3. Onglet **Environment** — colle ceci en remplaçant les valeurs :

```
APP_PASSWORD=un-mot-de-passe-long-et-unique
TWELVEDATA_KEY=ta-cle
FINNHUB_KEY=ta-cle
REFRESH_MINUTES=360
TZ=Europe/Paris
```

4. Onglet **Domains** : ajoute ton domaine, active **HTTPS** (Let's Encrypt),
   et règle le **port conteneur sur `3000`**.
5. Onglet **Advanced → Volumes** : monte un volume sur **`/data`**.
   C'est là que vivent ton portefeuille et tes sauvegardes — **sans ce volume,
   tout serait perdu à chaque redéploiement.**
6. **Deploy**.

> Tu peux aussi utiliser **Create → Compose** avec le `docker-compose.yml`
> fourni : le volume y est déjà déclaré.

### d. Vérifier

Ouvre `https://ton-domaine/api/health` → tu dois voir un JSON avec `"ok":true`.
Puis ouvre le domaine : l'écran de connexion demande `APP_PASSWORD`.

Les journaux au démarrage affichent un **autotest** (droits d'écriture,
sécurité des chemins, jetons de session) et la liste des fournisseurs actifs.
S'il y a un `✗`, tout est écrit en clair dans les logs Dokploy.

### e. Ce qui devient automatique

- Les cours se rafraîchissent **toutes les 6 h** (`REFRESH_MINUTES`), sans
  aucune action de ta part. Tu ouvres l'app, c'est déjà à jour.
- Le cache est partagé : ouvrir l'app sur ton téléphone ne reconsomme pas ton
  quota d'API.
- Une **sauvegarde quotidienne** de ton portefeuille est conservée 14 jours
  dans `/data/backups`.
- Ton portefeuille te suit d'un appareil à l'autre.

### Chat en langage naturel (facultatif)

Ajoute `ANTHROPIC_API_KEY=sk-ant-…` dans l'environnement. La clé reste sur le
serveur. Sans elle, InvestAI comprend déjà tes questions par analyse de
mots-clés — les chiffres sont produits par le moteur d'analyse dans les deux cas.

---

## 2. Version hors ligne

```bash
powershell -ExecutionPolicy Bypass -File build.ps1
```

Génère `MonInvestisseurIA.html` : un fichier unique, polices incluses, à ouvrir
d'un double-clic. Utile comme copie de secours ou pour travailler sans réseau.
Les clés d'API se saisissent alors dans **Réglages**.

---

## 3. Ce que fait l'application

- **Patrimoine** — total, performance, allocation réelle contre cible,
  investissements mensuels, revenus, rendement courant.
- **InvestAI** — l'agent. « j'ai 300 € à investir ce mois-ci », « est-ce que je
  suis assez diversifié ? », « compare ETF et Bricks ».
- **Portefeuille** — positions, liquidités, mouvements, et les expositions
  géographiques et sectorielles calculées **en transparence** (ETF décomposés).
- **ETF** — classement sur les frais, la diversification, l'encours,
  l'antériorité, le rendement ajusté du risque, l'apport à ton portefeuille et
  le rôle long terme (cœur ou satellite).
- **Actions** — score sur 100 : croissance, rentabilité, valorisation, dette,
  qualité, risque.
- **Immobilier** — projets classés sur le rapport rendement/risque, jamais sur
  le seul taux annoncé.
- **Opportunités**, **Mon plan**, **Simulateur** (3 scénarios + Monte-Carlo sur
  1 500 trajectoires), **Journal** des décisions relisible.

---

## 4. Les règles codées dans le moteur

1. **Jamais de donnée inventée.** Chaque chiffre porte sa source et sa date.
2. **Jamais de score partiel déguisé en score.** En dessous de 4 dimensions
   sur 6, aucune note globale n'est affichée.
3. **Jamais de prédiction.** L'agent n'affirme pas qu'un actif va monter.
4. **Jamais un classement sur la seule performance passée.**
5. **Ton portefeuille d'abord** — aucune proposition sans regarder l'existant.
6. **Un niveau de confiance sur 100**, expliqué, sur chaque analyse.
7. **Rééquilibrer par les versements**, pas par des ventes coûteuses.
8. **Immobilier participatif** : rendement non garanti, capital pouvant être
   perdu — rappelé partout.

---

## 5. Limites, dites franchement

- **Bricks n'a pas d'API publique ouverte.** Les projets se saisissent à la
  main : aucune récupération non autorisée n'est faite.
- **Les fiches ETF du catalogue sont saisies manuellement** et marquées « à
  vérifier ». Contrôle le DIC de l'émetteur avant d'acheter — l'application
  baisse d'elle-même sa confiance sur ces données.
- **La volatilité du portefeuille est une moyenne pondérée**, sans effet de
  corrélation : elle surestime le risque d'un portefeuille diversifié.
- **La concentration est mesurée en transparence**, le nombre de sociétés
  « effectives » d'un indice étant approximé par `lignes^0,6`.
- **Le serveur n'a pas pu être exécuté sur la machine de développement**
  (ni Node, ni Docker) : sa logique pure est couverte par 41 tests, et un
  autotest se lance à chaque démarrage du conteneur.
- **Ce n'est pas un conseil en investissement.** La décision finale
  t'appartient toujours.

---

## 6. Sécurité

- Accès protégé par mot de passe, session signée en HMAC-SHA256, cookie
  `HttpOnly` + `SameSite=Lax` + `Secure` derrière HTTPS.
- Limitation à 8 tentatives de connexion par quart d'heure et par IP.
- Comparaison du mot de passe à durée constante.
- Protection contre l'évasion de répertoire sur les fichiers statiques.
- En-têtes `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
- Corps de requête bornés, symboles de marché validés par liste blanche.
- **Les clés d'API ne sont jamais envoyées au navigateur.**
- Écritures atomiques : une coupure ne peut pas corrompre ton portefeuille ;
  en cas de fichier illisible, la dernière sauvegarde est restaurée.

> Si `APP_PASSWORD` est absent, l'application démarre **ouverte** et l'avertit
> en gros dans les journaux. Ne la déploie pas ainsi.

---

## 7. Structure

```
investlab/
├─ Dockerfile              image de production (aucune dépendance npm)
├─ docker-compose.yml      déploiement Dokploy
├─ .env.example            variables à renseigner
├─ build.ps1               génère la version hors ligne
├─ server/
│  ├─ server.js            HTTP, API, planification, autotest
│  └─ lib/
│     ├─ util.js           fonctions pures (couvertes par les tests)
│     ├─ providers.js      fournisseurs de marché, cache, repli
│     └─ store.js          persistance atomique + sauvegardes
└─ public/
   ├─ index.html
   ├─ css/app.css          thème sombre IBM Plex Mono
   ├─ fonts/               IBM Plex Mono auto-hébergée
   └─ js/
      ├─ api.js            liaison serveur, détection du mode
      ├─ data.js           profils, catalogue ETF, univers de scan
      ├─ store.js          état et calculs de portefeuille
      ├─ market.js         accès aux données (serveur ou direct)
      ├─ engine.js         moteurs d'analyse et de scoring
      ├─ agent.js          InvestAI : compréhension et réponses
      ├─ charts.js         graphiques SVG
      ├─ ui.js             rendu de l'interface
      └─ main.js           câblage
```
