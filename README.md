# Mon Investisseur IA

Application privée de suivi et d'analyse d'investissements, auto-hébergée.
Thème sombre, IBM Plex Mono, **aucune dépendance npm**, aucune donnée envoyée à un tiers.

Trois façons de l'utiliser, avec **exactement les mêmes analyses** :

| | Local (ton ordinateur) | En ligne (VPS + Dokploy) | Hors ligne (fichier unique) |
|---|---|---|---|
| Lancement | `npm start` | déploiement Git | double-clic |
| Accès | `localhost:3000` | ton domaine, tous tes appareils | le fichier |
| Clés d'API | dans `.env`, côté serveur | sur le serveur, jamais dans le navigateur | saisies dans l'app |
| Cours | bouton « Actualiser » + auto | rafraîchis **automatiquement** | bouton « Actualiser » |
| Données | `./data/` | sur ton VPS, synchronisées | dans ce navigateur |
| Accès protégé | mot de passe (facultatif) | mot de passe | — |

---

## 1. Démarrer en local — 30 secondes

Prérequis : **Node.js ≥ 20** (`node --version`). Rien d'autre à installer,
le projet n'a aucune dépendance npm.

```bash
npm start
```

Puis ouvre <http://localhost:3000>.

Sans `APP_PASSWORD`, l'application démarre **ouverte** — c'est le comportement
voulu en local, et le serveur t'en avertit dans la console.

### Avec tes clés d'API

```bash
cp .env.example .env
```

Renseigne ce que tu veux dans `.env`, puis :

```bash
npm run dev
```

`npm run dev` lit `.env` automatiquement (`--env-file-if-exists`) ; `npm start`
ne lit que les variables déjà présentes dans l'environnement.

### Où sont mes données ?

Dans **`./data/`** : `state.json` (ton portefeuille), `backups/` (14 jours),
`market-cache.json`. Ce dossier est exclu de Git. Pour le déplacer :

```bash
PORT=8080 DATA_DIR=/chemin/vers/mes-donnees APP_PASSWORD=secret npm start
```

Dans le conteneur, `DATA_DIR` vaut `/data` (fixé par le `Dockerfile`) et doit
être monté sur un volume.

### Les commandes disponibles

| Commande | Ce qu'elle fait |
|---|---|
| `npm start` | démarre le serveur |
| `npm run dev` | idem, en chargeant `.env` |
| `npm test` | lance les 94 tests (aucune dépendance, aucun réseau) |
| `npm run build:offline` | génère `MonInvestisseurIA.html` |

---

## 2. Vérifier que tout va bien

```bash
npm test
```

94 tests couvrent la logique pure — sécurité des chemins et des jetons,
persistance atomique, calculs de portefeuille, dates, moteurs de scoring et
simulateur. Ils s'exécutent avec le lanceur intégré de Node (`node:test`) :
ni framework, ni réseau, ni serveur à démarrer.

Au **démarrage**, le serveur lance en plus un autotest et l'écrit dans les
journaux : droits d'écriture, blocage de l'évasion de répertoire, validité et
falsification des jetons de session, disponibilité de `fetch`, lecture/écriture
de l'état. Un `✗` y est écrit en clair.

```bash
curl -s http://localhost:3000/api/health
```

Doit répondre un JSON contenant `"ok":true`.

---

## 3. Obtenir les clés gratuites (~3 min, facultatif)

| Clé | Sert à | Où |
|---|---|---|
| **Twelve Data** | cours et historiques — *la plus utile* | [twelvedata.com/pricing](https://twelvedata.com/pricing) — 800 req/jour |
| **Finnhub** | fondamentaux des actions (PER, marges, dette) | [finnhub.io/register](https://finnhub.io/register) |
| **Alpha Vantage** | secours (facultatif) | [alphavantage.co](https://www.alphavantage.co/support/#api-key) |

Sans aucune clé, l'application fonctionne : analyse de portefeuille, allocation,
rééquilibrage, plan, simulateur et immobilier. Seuls les cours et les
fondamentaux manquent — et l'agent te le dit plutôt que d'inventer.

Les taux de change viennent de **Frankfurter (BCE)**, qui ne demande pas de clé.

---

## 4. Déploiement sur ton VPS avec Dokploy

### a. Mettre le code sur un dépôt Git

Dokploy déploie depuis un dépôt. Depuis ce dossier :

```bash
git init && git add -A && git commit -m "Mon Investisseur IA"
```

Puis crée un dépôt **privé** (GitHub, GitLab ou ton Gitea) et pousse-le.
Le `.gitignore` exclut déjà `.env` et `data/` : aucun secret ne partira.

### b. Créer l'application dans Dokploy

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

### c. Vérifier

Ouvre `https://ton-domaine/api/health` → un JSON avec `"ok":true`.
Puis ouvre le domaine : l'écran de connexion demande `APP_PASSWORD`.

### d. Tester l'image en local avant de déployer

```bash
docker compose up --build
```

### e. Ce qui devient automatique

- Les cours se rafraîchissent **toutes les 6 h** (`REFRESH_MINUTES`), sans
  aucune action de ta part.
- Le cache est partagé : ouvrir l'app sur ton téléphone ne reconsomme pas ton
  quota d'API.
- Une **sauvegarde quotidienne** de ton portefeuille est conservée 14 jours
  dans `/data/backups`. Un fichier illisible déclenche une restauration
  automatique depuis la dernière sauvegarde valide.
- Ton portefeuille te suit d'un appareil à l'autre.

### Chat en langage naturel (facultatif)

Ajoute `ANTHROPIC_API_KEY=sk-ant-…` dans l'environnement. La clé reste sur le
serveur. Sans elle, InvestAI comprend déjà tes questions par analyse de
mots-clés — les chiffres sont produits par le moteur d'analyse dans les deux cas.

---

## 5. Version hors ligne (fichier unique)

```bash
npm run build:offline
```

Génère `MonInvestisseurIA.html` : un fichier unique (~390 Ko), polices et
scripts intégrés, à ouvrir d'un double-clic. Utile comme copie de secours ou
pour travailler sans réseau. Les clés d'API se saisissent alors dans **Réglages**
et restent dans ce navigateur.

Le script est multiplateforme (macOS, Linux, Windows). `build.ps1` fait la même
chose en PowerShell et n'est conservé que pour compatibilité.

> Régénère le fichier après **toute** modification de `public/` : il fige une
> copie du code, il ne s'actualise pas tout seul.

---

## 6. Ce que fait l'application

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

Pour découvrir l'interface sans saisir tes vraies données :
**Réglages → Charger un jeu de démonstration**.

---

## 7. Les règles codées dans le moteur

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

## 8. Limites, dites franchement

- **Bricks n'a pas d'API publique ouverte.** Les projets se saisissent à la
  main : aucune récupération non autorisée n'est faite.
- **Les fiches ETF du catalogue sont saisies manuellement** et marquées « à
  vérifier ». Contrôle le DIC de l'émetteur avant d'acheter — l'application
  baisse d'elle-même sa confiance sur ces données.
- **La volatilité du portefeuille est une moyenne pondérée**, sans effet de
  corrélation : elle surestime le risque d'un portefeuille diversifié.
- **La concentration est mesurée en transparence**, le nombre de sociétés
  « effectives » d'un indice étant approximé par `lignes^0,6`.
- **Le Monte-Carlo est déterministe** (générateur à graine fixe) : deux
  simulations identiques donnent le même résultat, ce qui est voulu — mais ce
  n'est pas un tirage aléatoire indépendant.
- **Finnhub ne dit pas dans quelle devise il cote.** Un cours qui en provient
  est marqué « devise non confirmée » ; si une conversion est nécessaire et que
  le taux BCE est indisponible, le cours n'est **pas** mis à jour plutôt que
  d'être inscrit dans la mauvaise devise.
- **Ce n'est pas un conseil en investissement.** La décision finale
  t'appartient toujours.

---

## 9. Sécurité

- Accès protégé par mot de passe, session signée en HMAC-SHA256, cookie
  `HttpOnly` + `SameSite=Lax` + `Secure` derrière HTTPS.
- Limitation à 8 tentatives de connexion par quart d'heure et par IP,
  600 requêtes API par minute.
- Comparaison du mot de passe à durée constante.
- Protection contre l'évasion de répertoire sur les fichiers statiques.
- En-têtes `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
- Corps de requête bornés, symboles de marché validés par liste blanche.
- Échappement HTML systématique de tout ce que tu saisis.
- **Les clés d'API ne sont jamais envoyées au navigateur** et ne figurent pas
  dans les exports.
- Écritures atomiques : une coupure ne peut pas corrompre ton portefeuille ;
  en cas de fichier illisible, la dernière sauvegarde est restaurée et le
  fichier abîmé est conservé pour analyse, jamais supprimé.
- Le conteneur tourne sous l'utilisateur non privilégié `node`.

> Si `APP_PASSWORD` est absent, l'application démarre **ouverte** et l'avertit
> en gros dans les journaux. Pratique en local, à ne jamais déployer ainsi.

---

## 10. En cas de problème

| Symptôme | Cause probable | Solution |
|---|---|---|
| `ENOENT: mkdir '/data'` | un `DATA_DIR=/data` traîne dans l'environnement | `unset DATA_DIR`, ou pointe un dossier accessible |
| `EADDRINUSE` | le port 3000 est déjà pris | `PORT=3001 npm start`, ou arrête l'autre serveur |
| `Cannot find module` | Node trop ancien | Node ≥ 20 requis (`node --version`) |
| Page blanche | ouverture directe de `public/index.html` | passe par `npm start`, ou utilise `MonInvestisseurIA.html` |
| « Aucun fournisseur configuré » | aucune clé d'API | normal — voir §3, ou ignore : le reste fonctionne |
| L'écran de connexion refuse le mot de passe | `APP_PASSWORD` non transmis au processus | `npm run dev` avec un `.env`, ou passe-le en variable |
| Trop de tentatives | limiteur de connexion déclenché | attends 15 minutes, ou redémarre le serveur |
| Le fichier hors ligne est périmé | `public/` a changé depuis | `npm run build:offline` |

Les journaux du serveur disent tout : chaque appel d'API, chaque échec de
fournisseur et chaque rafraîchissement y sont tracés avec leur durée.

---

## 11. Structure

```
investlab/
├─ package.json            scripts npm (aucune dépendance)
├─ Dockerfile              image de production
├─ docker-compose.yml      déploiement Dokploy
├─ .env.example            variables à renseigner
├─ server/
│  ├─ server.js            HTTP, API, planification, autotest
│  └─ lib/
│     ├─ util.js           fonctions pures (chemins, jetons, cache, quotas)
│     ├─ providers.js      fournisseurs de marché, cache, repli, statistiques
│     └─ store.js          persistance atomique + sauvegardes
├─ public/
│  ├─ index.html
│  ├─ css/app.css          thème sombre IBM Plex Mono
│  ├─ fonts/               IBM Plex Mono auto-hébergée
│  └─ js/
│     ├─ api.js            liaison serveur, détection du mode
│     ├─ data.js           profils, catalogue ETF, univers de scan
│     ├─ store.js          état et calculs de portefeuille
│     ├─ market.js         accès aux données (serveur ou direct)
│     ├─ engine.js         moteurs d'analyse et de scoring
│     ├─ agent.js          InvestAI : compréhension et réponses
│     ├─ charts.js         graphiques SVG
│     ├─ ui.js             rendu de l'interface
│     └─ main.js           câblage
├─ scripts/
│  └─ build-offline.mjs    génère le fichier unique (multiplateforme)
├─ build.ps1               équivalent PowerShell, pour compatibilité
└─ test/
   ├─ _browser-env.js      charge les modules front dans Node
   ├─ util.test.js         chemins, cookies, jetons, cache, quotas
   ├─ store.test.js        persistance atomique, sauvegardes, corruption
   ├─ portfolio.test.js    dates, valorisation, import/export
   ├─ engine.test.js       confiance, scoring, plan, simulateur
   └─ market-stats.test.js volatilité, drawdown, CAGR, échantillonnage
```
