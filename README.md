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
| Import par photo | clé Anthropic dans `.env` | clé Anthropic sur le serveur | clé saisie dans l'app |
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
| `npm test` | lance les 135 tests (aucune dépendance, aucun réseau) |
| `npm run build:offline` | génère `MonInvestisseurIA.html` |

---

## 2. Vérifier que tout va bien

```bash
npm test
```

135 tests couvrent la logique pure — sécurité des chemins et des jetons,
persistance atomique, calculs de portefeuille, dates, moteurs de scoring,
simulateur, alertes de prix et lecture des captures d'écran. Ils s'exécutent avec le lanceur intégré de Node (`node:test`) :
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
| **Twelve Data** | cours et historiques des ETF et actions | [twelvedata.com/pricing](https://twelvedata.com/pricing) — 800 req/jour |
| **Finnhub** | fondamentaux des actions (PER, marges, dette) | [finnhub.io/register](https://finnhub.io/register) |
| **Alpha Vantage** | secours (facultatif) | [alphavantage.co](https://www.alphavantage.co/support/#api-key) |
| **Anthropic** | lecture des captures d'écran + chat | [console.anthropic.com](https://console.anthropic.com/) — payant à l'usage |

Deux sources ne demandent **aucune clé** et fonctionnent toujours :

- **CoinGecko** — cours et historiques des **cryptoactifs** ;
- **Frankfurter (BCE)** — taux de change.

Autrement dit : un portefeuille **entièrement crypto se valorise sans rien
configurer**. Les clés ci-dessus ne servent qu'aux ETF, aux actions et à
l'import par photo.

Sans aucune clé, le reste fonctionne aussi : analyse de portefeuille, allocation,
rééquilibrage, plan, simulateur et immobilier. Ce qui manque manque
explicitement — l'agent le dit plutôt que d'inventer.

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
- **Portefeuille** — positions, mouvements, et les expositions géographiques et
  sectorielles calculées **en transparence** (ETF décomposés).
- **Import par photo** — envoie des captures d'écran de Binance, Bitstack,
  Crypto.com, ton courtier… InvestAI en extrait les positions et te les présente
  dans un tableau **que tu valides ligne par ligne** avant toute création.
- **Crypto** — les cryptoactifs sont une classe d'actifs à part entière, cotée
  par CoinGecko sans clé d'API, avec sa propre cible d'allocation et son propre
  plafond de risque par profil.
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

## 7. Importer un portefeuille depuis des photos

**Portefeuille → ⤢ Importer des positions.** Deux chemins mènent au même écran
de vérification.

### a. Coller un relevé — sans aucune clé

Onglet **« Coller un relevé »** : colle un objet JSON décrivant tes positions.

```json
{"positions":[
  {"type":"crypto","ticker":"BTC","name":"Bitcoin","quantity":0.0842,
   "avgPrice":52000,"currency":"EUR","account":"Bitstack"},
  {"type":"crypto","ticker":"ETH","name":"Ethereum","quantity":1.35,
   "avgPrice":2100,"currency":"EUR","account":"Binance"}
]}
```

C'est le format que produit n'importe quel assistant à qui tu montres tes
captures d'écran — y compris Claude dans une conversation ordinaire. Aucune clé
d'API n'est nécessaire : la lecture se fait ailleurs, l'application ne fait que
vérifier et créer.

### b. Lire des images — avec une clé Anthropic

Onglet **« Lire des images »** : dépose jusqu'à 8 captures d'écran. Les images
sont réduites dans ton navigateur, envoyées à Claude, et les positions lues
s'affichent dans le même tableau de vérification.

**Rien n'est créé sans ta validation.** Chaque ligne porte :

- un **niveau de confiance** de lecture (haute / moyenne / basse) ;
- ce qui a été lu **littéralement**, en infobulle ;
- les champs illisibles laissés **vides et surlignés en rouge** — jamais devinés.

Tu décoches ce que tu ne veux pas, tu corriges ce qui est faux, puis tu crées.

### Ce qu'il faut savoir

- Seul l'onglet « Lire des images » demande une **clé Anthropic**
  (`ANTHROPIC_API_KEY` côté serveur, ou saisie dans **Réglages** hors ligne).
  Le collage d'un relevé fonctionne toujours.
- Un **prix de revient n'est jamais déduit d'un cours affiché**. Beaucoup
  d'applications crypto ne montrent que le cours du moment : dans ce cas le PRU
  reste vide et tu le saisis toi-même, sinon ta plus-value serait fausse.
- Une lecture d'image **n'est pas une source de vérité**. Vérifie les quantités :
  c'est le champ que les captures rognent le plus souvent.
- Les images ne sont **pas conservées** : elles transitent, la réponse revient au
  navigateur, rien n'est stocké côté serveur.

---

## 8. Démarrer avec un portefeuille concentré

Si tu ne détiens qu'une seule classe d'actifs — que de la crypto, par exemple —
la cible théorique de ton profil produit une page d'écarts d'allocation qui
noie tout le reste.

**Réglages → ↧ Caler sur ma répartition actuelle** aligne la cible sur ce que tu
détiens réellement. Les alertes d'allocation disparaissent ; **celles de risque
restent** — concentration, poche crypto au-dessus de ta tolérance, nombre
d'expositions effectives. C'est voulu : caler la cible rend l'écran lisible, ça
ne rend pas un portefeuille concentré prudent pour autant.

Ensuite, tu déplaces les curseurs vers là où tu veux aller, et « Mon plan »
oriente tes versements dans cette direction — sans jamais te faire vendre :
rééquilibrer par les apports coûte moins cher en frais et en impôt.

---

## 9. Alertes de prix

**Portefeuille → + Alerte.** Choisis un actif, un sens (« atteint » ou
« descend sous »), un seuil, et une note pour te rappeler ce que tu comptes
faire à ce niveau.

| | |
|---|---|
| Quand sont-elles vérifiées ? | à chaque rafraîchissement des cours |
| Navigateur fermé ? | **oui en mode serveur** : le rafraîchissement automatique les évalue, tu les découvres à ta prochaine visite |
| Notification système | seulement si l'onglet est ouvert et la permission accordée |
| Notification sur téléphone, app fermée | **non** — cela demanderait un service de push, absent de ce projet auto-hébergé |
| Se redéclenche-t-elle ? | non : une fois déclenchée, elle reste à réarmer (↻). Un cours qui oscille autour du seuil n'alerte donc qu'une fois |
| Passe-t-elle des ordres ? | **jamais.** Une alerte prévient, elle ne décide pas |

La règle de déclenchement vit dans `public/js/alerts-rules.js` — **un seul
fichier**, chargé par le navigateur et par le serveur (`require`). Deux
évaluations divergentes seraient pires que pas d'alerte du tout.

---

## 10. Les règles codées dans le moteur

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

## 11. Limites, dites franchement

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
- **Aucun cryptoactif n'est noté.** Un jeton n'a ni bénéfice, ni dividende, ni
  bilan : aucun score comparable à celui d'un ETF ou d'une action ne serait
  honnête. L'application mesure ton **exposition** et son risque, elle ne
  désigne jamais un jeton à acheter.
- **La lecture de photos peut se tromper.** C'est pourquoi elle passe toujours
  par un écran de validation. Ne l'utilise pas comme un import comptable.
- **Les liquidités ne comptent pas dans le patrimoine** : elles vivent sur un
  autre compte. « Capital disponible », dans Réglages, ne sert qu'à alimenter
  « Mon plan ». Les comptes de liquidités saisis avant cette version sont
  conservés dans tes données mais ne sont plus ni affichés ni valorisés.
- **Ce n'est pas un conseil en investissement.** La décision finale
  t'appartient toujours.

---

## 12. Sécurité

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

## 13. En cas de problème

| Symptôme | Cause probable | Solution |
|---|---|---|
| `ENOENT: mkdir '/data'` | un `DATA_DIR=/data` traîne dans l'environnement | `unset DATA_DIR`, ou pointe un dossier accessible |
| `EADDRINUSE` | le port 3000 est déjà pris | `PORT=3001 npm start`, ou arrête l'autre serveur |
| `Cannot find module` | Node trop ancien | Node ≥ 20 requis (`node --version`) |
| Page blanche | ouverture directe de `public/index.html` | passe par `npm start`, ou utilise `MonInvestisseurIA.html` |
| « Aucun fournisseur configuré » | aucune clé d'API | normal pour les ETF/actions — les cryptos se cotent quand même |
| Une crypto ne se cote pas | ticker absent du catalogue CoinGecko | ajoute-le dans `CRYPTO_CATALOG` (`public/js/data.js`) et `COINGECKO_IDS` (`server/lib/providers.js`) |
| « Lire des images » est verrouillé | `ANTHROPIC_API_KEY` absente | utilise l'onglet « Coller un relevé », qui n'en demande pas |
| Une page d'écarts d'allocation | portefeuille concentré sur une classe | Réglages → ↧ Caler sur ma répartition actuelle (§8) |
| L'écran de connexion refuse le mot de passe | `APP_PASSWORD` non transmis au processus | `npm run dev` avec un `.env`, ou passe-le en variable |
| Trop de tentatives | limiteur de connexion déclenché | attends 15 minutes, ou redémarre le serveur |
| Le fichier hors ligne est périmé | `public/` a changé depuis | `npm run build:offline` |

Les journaux du serveur disent tout : chaque appel d'API, chaque échec de
fournisseur et chaque rafraîchissement y sont tracés avec leur durée.

---

## 14. Structure

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
│     ├─ vision.js         import de positions depuis des captures d'écran
│     ├─ alerts-rules.js   règle de déclenchement (partagée avec le serveur)
│     ├─ alerts.js         alertes : interface, notifications
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
   ├─ vision.test.js       lecture des captures, normalisation, garde-fous
   ├─ alerts.test.js       seuils, non-redéclenchement, réarmement
   └─ market-stats.test.js volatilité, drawdown, CAGR, échantillonnage
```
