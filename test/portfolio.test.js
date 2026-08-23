/* Tests du portefeuille et des dates (public/js/store.js). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadFront } = require('./_browser-env.js');

const fresh = () => {
  const w = loadFront(['data.js', 'store.js']);
  w.Store.load();
  return w;
};

/* =============================================================== DATES ===
   Ces tests verrouillent une régression réelle : `toISOString()` bascule en
   UTC, si bien qu'à Paris le 1er du mois à 00 h 00 locale devenait le dernier
   jour du mois précédent — le mois courant n'apparaissait jamais dans le
   graphique des versements.                                                */
test('todayISO rend la date locale, pas la date UTC', () => {
  const w = fresh();
  const d = new Date();
  const attendu = d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
  assert.strictEqual(w.Store.todayISO(), attendu);
});

test('localISO ne décale pas le 1er du mois vers le mois précédent', () => {
  const w = fresh();
  assert.strictEqual(w.Store.localISO(new Date(2026, 7, 1)), '2026-08-01');
  assert.strictEqual(w.Store.localISO(new Date(2026, 0, 1)), '2026-01-01');
  assert.strictEqual(w.Store.localISO(new Date(2026, 11, 31)), '2026-12-31');
});

test('monthKey accepte une chaîne, une Date, ou rien', () => {
  const w = fresh();
  assert.strictEqual(w.Store.monthKey('2026-08-23'), '2026-08');
  assert.strictEqual(w.Store.monthKey(new Date(2026, 7, 1)), '2026-08');
  assert.strictEqual(w.Store.monthKey(), w.Store.todayISO().slice(0, 7));
});

test('monthlySeries se termine sur le mois courant', () => {
  const w = fresh();
  const s = w.Store.monthlySeries(12);
  assert.strictEqual(s.length, 12);
  assert.strictEqual(s[11].month, w.Store.monthKey(), 'le dernier point est le mois en cours');
  // Array.from : les objets rendus par le bac à sable appartiennent à un autre
  // realm, deepStrictEqual comparerait alors des prototypes différents.
  const mois = Array.from(s, x => x.month);
  assert.strictEqual(new Set(mois).size, 12, 'aucun mois en double');
  assert.deepStrictEqual(mois, [...mois].sort(), 'ordre chronologique');
});

test('monthlySeries traverse correctement un changement d\'année', () => {
  const w = fresh();
  const s = w.Store.monthlySeries(18);
  for (let i = 1; i < s.length; i++) {
    const [ay, am] = s[i - 1].month.split('-').map(Number);
    const [by, bm] = s[i].month.split('-').map(Number);
    assert.strictEqual(by * 12 + bm, ay * 12 + am + 1, 'mois consécutifs');
  }
});

test('un achat du mois est compté dans le mois courant', () => {
  const w = fresh();
  w.Store.addTransaction({ date: w.Store.todayISO(), kind: 'buy', amount: 250 });
  assert.strictEqual(w.Store.investedInMonth(), 250);
  const s = w.Store.monthlySeries(12);
  assert.strictEqual(s[11].amount, 250, 'visible sur le dernier point du graphique');
});

/* ======================================================== VALORISATION === */
test('priceOf préfère le cours de marché et signale son absence', () => {
  const w = fresh();
  const live = w.Store.priceOf({ lastPrice: 465, avgPrice: 420, lastPriceSource: 'Twelve Data' });
  assert.strictEqual(live.price, 465);
  assert.strictEqual(live.live, true);

  const froid = w.Store.priceOf({ lastPrice: null, avgPrice: 420 });
  assert.strictEqual(froid.price, 420);
  assert.strictEqual(froid.live, false);
  assert.match(froid.source, /prix de revient/, 'l\'origine du prix reste explicite');
});

test('un prix nul ou négatif ne remplace pas le prix de revient', () => {
  const w = fresh();
  assert.strictEqual(w.Store.priceOf({ lastPrice: 0, avgPrice: 100 }).live, false);
  assert.strictEqual(w.Store.priceOf({ lastPrice: -5, avgPrice: 100 }).live, false);
});

test('snapshot consolide valeurs, plus-values et allocation', () => {
  const w = fresh();
  w.Store.addHolding({ type: 'etf', ticker: 'CW8', quantity: 10, avgPrice: 400, lastPrice: 500 });
  w.Store.addHolding({ type: 'action', ticker: 'AAPL', quantity: 10, avgPrice: 100, lastPrice: 150 });
  w.Store.addHolding({ type: 'crypto', ticker: 'BTC', quantity: 0.05, avgPrice: 40000, lastPrice: 50000 });
  w.Store.addBrick({ name: 'Lyon', amount: 1000, yieldPct: 9 });

  const s = w.Store.snapshot();
  assert.strictEqual(s.etfValue, 5000);
  assert.strictEqual(s.stockValue, 1500);
  assert.strictEqual(s.cryptoValue, 2500);
  assert.strictEqual(s.bricksValue, 1000);
  assert.strictEqual(s.total, 10000);
  assert.strictEqual(s.pl, 2000, '(5000-4000) + (1500-1000) + (2500-2000)');
  assert.strictEqual(s.alloc.etf, 50);
  assert.strictEqual(s.alloc.crypto, 25);
  const somme = Object.values(s.alloc).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(somme - 100) < 1e-9, 'l\'allocation totalise 100 %');
});

test('les liquidités ne comptent pas dans le patrimoine', () => {
  const w = fresh();
  w.Store.addHolding({ type: 'etf', ticker: 'CW8', quantity: 10, avgPrice: 400, lastPrice: 400 });
  w.Store.addCash({ label: 'Livret A', amount: 9999 });     // saisi jadis, conservé
  w.Store.state.profile.availableCash = 5000;               // paramètre de « Mon plan »
  const s = w.Store.snapshot();
  assert.strictEqual(s.total, 4000, 'ni le livret ni le capital disponible n\'entrent au patrimoine');
  assert.strictEqual(s.cashValue, undefined, 'la notion de liquidités a disparu du snapshot');
  assert.strictEqual(w.Store.state.cashAccounts.length, 1, 'la donnée saisie n\'est pas détruite');
});

test('une cible héritée avec `cash` est migrée vers `crypto`', () => {
  const w = fresh();
  w.Store.importJSON(JSON.stringify({
    profile: { target: { etf: 60, actions: 15, immobilier: 20, cash: 5 } }
  }));
  const t = w.Store.state.profile.target;
  assert.strictEqual(t.crypto, 5, 'l\'ancien poids liquidités devient le poids crypto');
  assert.strictEqual(t.cash, undefined);
  assert.strictEqual(t.etf + t.actions + t.crypto + t.immobilier, 100, 'la cible totalise toujours 100 %');
});

test('une position de type inconnu reste valorisable', () => {
  const w = fresh();
  w.Store.importJSON(JSON.stringify({
    holdings: [{ id: 'x', type: 'obligation', ticker: 'Z', quantity: 2, avgPrice: 50 }]
  }));
  assert.strictEqual(w.Store.state.holdings[0].type, 'etf');
  assert.strictEqual(w.Store.snapshot().total, 100);
});

test('cryptoMeta reconnaît un ticker seul comme une paire', () => {
  const w = fresh();
  assert.strictEqual(w.Store.cryptoMeta('btc').id, 'bitcoin');
  assert.strictEqual(w.Store.cryptoMeta('ETH/EUR').id, 'ethereum');
  assert.strictEqual(w.Store.cryptoMeta('AAPL'), null);
});

test('un portefeuille vide ne produit ni NaN ni division par zéro', () => {
  const w = fresh();
  const s = w.Store.snapshot();
  for (const [k, v] of Object.entries({ total: s.total, pl: s.pl, plPct: s.plPct, ...s.alloc })) {
    assert.ok(Number.isFinite(v), k + ' doit rester un nombre fini, reçu ' + v);
  }
  assert.strictEqual(s.total, 0);
});

test('un projet remboursé ou perdu sort de la poche immobilière', () => {
  const w = fresh();
  w.Store.addBrick({ name: 'en cours', amount: 1000, status: 'en cours' });
  w.Store.addBrick({ name: 'remboursé', amount: 5000, status: 'remboursé' });
  w.Store.addBrick({ name: 'perdu', amount: 3000, status: 'perdu' });
  assert.strictEqual(w.Store.snapshot().bricksValue, 1000);
});



/* ============================================================ REVENUS === */
test('incomeLast12m ne retient que les revenus de moins d\'un an', () => {
  const w = fresh();
  const vieux = new Date(); vieux.setFullYear(vieux.getFullYear() - 2);
  w.Store.addTransaction({ date: w.Store.todayISO(), kind: 'dividend', amount: 100 });
  w.Store.addTransaction({ date: w.Store.todayISO(), kind: 'interest', amount: 50 });
  w.Store.addTransaction({ date: w.Store.localISO(vieux), kind: 'dividend', amount: 999 });
  w.Store.addTransaction({ date: w.Store.todayISO(), kind: 'buy', amount: 800 });
  assert.strictEqual(w.Store.incomeLast12m(), 150, 'achats et vieux dividendes exclus');
});

test('currentYield ajoute les coupons immobiliers attendus', () => {
  const w = fresh();
  w.Store.addBrick({ name: 'Lyon', amount: 1000, yieldPct: 10, status: 'en cours' });
  const y = w.Store.currentYield(w.Store.snapshot());
  assert.strictEqual(y.expectedRealEstate, 100);
  assert.strictEqual(y.pct, 10);
});

/* ================================================== IMPORT / EXPORT ===== */
test('l\'export ne contient jamais de clé d\'API', () => {
  const w = fresh();
  w.Store.state.settings.keys.twelvedata = 'SECRET-A-NE-PAS-FUIR';
  const dump = w.Store.exportJSON();
  assert.doesNotMatch(dump, /SECRET-A-NE-PAS-FUIR/);
  assert.strictEqual(JSON.parse(dump).settings.keys.twelvedata, '');
});

test('l\'import restaure le portefeuille et conserve les clés locales', () => {
  const w = fresh();
  w.Store.addHolding({ ticker: 'CW8', quantity: 5, avgPrice: 400 });
  const dump = w.Store.exportJSON();

  const w2 = fresh();
  w2.Store.state.settings.keys.finnhub = 'MA-CLE-LOCALE';
  w2.Store.importJSON(dump);
  assert.strictEqual(w2.Store.state.holdings.length, 1);
  assert.strictEqual(w2.Store.state.holdings[0].ticker, 'CW8');
  assert.strictEqual(w2.Store.state.settings.keys.finnhub, 'MA-CLE-LOCALE');
});

test('un import d\'un état partiel ne casse pas la structure', () => {
  const w = fresh();
  w.Store.importJSON(JSON.stringify({ holdings: [{ ticker: 'X', quantity: 1, avgPrice: 10 }] }));
  const st = w.Store.state;
  for (const k of ['profile', 'bricks', 'cashAccounts', 'transactions', 'journal', 'watchlist', 'settings']) {
    assert.ok(st[k] !== undefined, 'clé manquante restaurée : ' + k);
  }
  assert.ok(Number.isFinite(w.Store.snapshot().total));
});

test('la watchlist refuse les doublons, quelle que soit la casse', () => {
  const w = fresh();
  assert.ok(w.Store.addWatch({ ticker: 'MSFT' }));
  assert.strictEqual(w.Store.addWatch({ ticker: 'msft' }), null);
  assert.strictEqual(w.Store.state.watchlist.length, 1);
});

test('supprimer une position supprime ses mouvements', () => {
  const w = fresh();
  const h = w.Store.addHolding({ ticker: 'CW8', quantity: 5, avgPrice: 400 });
  w.Store.addTransaction({ kind: 'buy', holdingId: h.id, amount: 2000 });
  w.Store.addTransaction({ kind: 'buy', holdingId: 'autre', amount: 500 });
  w.Store.removeHolding(h.id);
  assert.strictEqual(w.Store.state.holdings.length, 0);
  assert.strictEqual(w.Store.state.transactions.length, 1, 'seul le mouvement orphelin reste');
});

test('addTransaction déduit le montant de quantité × prix', () => {
  const w = fresh();
  const t = w.Store.addTransaction({ kind: 'buy', quantity: 4, price: 25 });
  assert.strictEqual(t.amount, 100);
});

/* ============================================== FUSION D'ÉTAT (régression) ==
   `typeof null` vaut 'object'. Sans garde-fou, fusionner un état vierge (où
   settings.lastRefresh vaut null) avec un état enregistré (où il vaut une date)
   levait « Cannot use 'in' operator » — l'application ne démarrait donc plus
   dès le premier rechargement suivant un rafraîchissement des cours.        */
test('un champ null de l\'état vierge accepte une valeur enregistrée', () => {
  const w = fresh();
  assert.strictEqual(w.Store.state.settings.lastRefresh, null, 'null dans l\'état vierge');
  w.Store.replaceState({ settings: { lastRefresh: '2026-08-23T10:00:00.000Z' } });
  assert.strictEqual(w.Store.state.settings.lastRefresh, '2026-08-23T10:00:00.000Z');
});

test('replaceState survit à des types incompatibles sans lever', () => {
  const w = fresh();
  for (const bizarre of [
    { settings: { keys: 'pas-un-objet' } },
    { profile: null },
    { holdings: 'pas-un-tableau' },
    { settings: { lastRefresh: { imbrique: true } } }
  ]) {
    assert.doesNotThrow(() => w.Store.replaceState(bizarre), JSON.stringify(bizarre));
  }
  assert.ok(Number.isFinite(w.Store.snapshot().total));
});
