/* Tests de la lecture de captures d'écran (public/js/vision.js).
   On ne teste pas le modèle — on teste que l'application ne fait JAMAIS
   confiance à sa sortie : formats variés, champs manquants, réponse bruitée. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadFront } = require('./_browser-env.js');

const fresh = () => {
  const w = loadFront(['api.js', 'data.js', 'store.js', 'market.js', 'vision.js']);
  w.Store.load();
  return w;
};
const rep = o => JSON.stringify(o);

/* =========================================================== EXTRACTION === */
test('une réponse JSON nue est lue', () => {
  const w = fresh();
  const r = w.Vision.parse(rep({ positions: [{ type: 'crypto', ticker: 'BTC', quantity: 0.5 }], warnings: [], detected: 'Binance' }));
  assert.strictEqual(r.positions.length, 1);
  assert.strictEqual(r.detected, 'Binance');
});

test('une réponse encadrée d\'un bloc de code est lue', () => {
  const w = fresh();
  const brut = '```json\n' + rep({ positions: [{ ticker: 'ETH', quantity: 1 }] }) + '\n```';
  assert.strictEqual(w.Vision.parse(brut).positions.length, 1);
});

test('une réponse bavarde autour du JSON est lue', () => {
  const w = fresh();
  const brut = 'Voici ce que je lis :\n' + rep({ positions: [{ ticker: 'SOL', quantity: 3 }] }) + '\nJ\'espère que cela aide.';
  assert.strictEqual(w.Vision.parse(brut).positions[0].ticker, 'SOL');
});

test('une réponse illisible lève une erreur explicite', () => {
  const w = fresh();
  for (const bad of ['', 'je ne vois rien', '{ ceci n\'est pas du json }']) {
    assert.throws(() => w.Vision.parse(bad), /illisible|vide|JSON|Unexpected|Expected/i, JSON.stringify(bad));
  }
});

test('une réponse sans positions ne lève pas', () => {
  const w = fresh();
  const r = w.Vision.parse(rep({ positions: [], warnings: ['image floue'], detected: null }));
  assert.strictEqual(r.positions.length, 0);
  assert.strictEqual(r.warnings[0], 'image floue');
});

test('un champ positions absent ou du mauvais type est neutralisé', () => {
  const w = fresh();
  // longueurs comparées, pas les tableaux : ceux du bac à sable appartiennent
  // à un autre realm et échoueraient un deepStrictEqual sur le prototype.
  assert.strictEqual(w.Vision.parse(rep({ warnings: [] })).positions.length, 0);
  assert.strictEqual(w.Vision.parse(rep({ positions: 'BTC' })).positions.length, 0);
  assert.strictEqual(w.Vision.parse(rep({ positions: null })).positions.length, 0);
});

/* ========================================================= NORMALISATION === */
test('les nombres au format français sont convertis', () => {
  const w = fresh();
  const p = w.Vision.clean({ ticker: 'BTC', quantity: '0,0842', avgPrice: '52 000,50' });
  assert.strictEqual(p.quantity, 0.0842);
  assert.strictEqual(p.avgPrice, 52000.5);
});

test('un nombre illisible reste nul plutôt que d\'être deviné (règle 1)', () => {
  const w = fresh();
  for (const v of [null, '', '???', 'n/a', undefined]) {
    assert.strictEqual(w.Vision.clean({ ticker: 'BTC', quantity: v }).quantity, null, JSON.stringify(v));
  }
});

test('un ticker connu du catalogue impose le type crypto', () => {
  const w = fresh();
  assert.strictEqual(w.Vision.clean({ ticker: 'ETH' }).type, 'crypto', 'type absent');
  assert.strictEqual(w.Vision.clean({ type: 'etf', ticker: 'SOL' }).type, 'crypto', 'type erroné corrigé');
  assert.strictEqual(w.Vision.clean({ type: 'action', ticker: 'AAPL' }).type, 'action', 'une action reste une action');
});

test('un type fantaisiste retombe sur une valeur valide', () => {
  const w = fresh();
  const p = w.Vision.clean({ type: 'obligation-perpétuelle', ticker: 'ZZZZ' });
  assert.ok(['etf', 'action', 'crypto'].includes(p.type));
});

test('le nom manquant est complété depuis le catalogue crypto', () => {
  const w = fresh();
  assert.strictEqual(w.Vision.clean({ ticker: 'BTC' }).name, 'Bitcoin');
  assert.strictEqual(w.Vision.clean({ ticker: 'ZZZZ' }).name, '', 'aucun nom inventé hors catalogue');
});

test('une ligne sans ticker ni nom est écartée', () => {
  const w = fresh();
  assert.strictEqual(w.Vision.clean({ quantity: 5 }), null);
  assert.strictEqual(w.Vision.clean(null), null);
  assert.strictEqual(w.Vision.clean('BTC'), null);
});

test('une devise invalide retombe sur l\'euro', () => {
  const w = fresh();
  assert.strictEqual(w.Vision.clean({ ticker: 'BTC', currency: 'dollars' }).currency, 'EUR');
  assert.strictEqual(w.Vision.clean({ ticker: 'BTC', currency: 'usd' }).currency, 'USD');
});

test('les chaînes trop longues sont bornées', () => {
  const w = fresh();
  const p = w.Vision.clean({ ticker: 'X'.repeat(50), name: 'N'.repeat(200), account: 'A'.repeat(100) });
  assert.ok(p.ticker.length <= 20 && p.name.length <= 80 && p.account.length <= 30);
});

test('un niveau de confiance absent ou fantaisiste devient « moyenne »', () => {
  const w = fresh();
  assert.strictEqual(w.Vision.clean({ ticker: 'BTC' }).confidence, 'moyenne');
  assert.strictEqual(w.Vision.clean({ ticker: 'BTC', confidence: 'certaine' }).confidence, 'moyenne');
  assert.strictEqual(w.Vision.clean({ ticker: 'BTC', confidence: 'basse' }).confidence, 'basse');
});

test('chaque ligne extraite est cochée par défaut mais identifiable', () => {
  const w = fresh();
  const a = w.Vision.clean({ ticker: 'BTC' }), b = w.Vision.clean({ ticker: 'ETH' });
  assert.strictEqual(a._keep, true);
  assert.notStrictEqual(a._id, b._id, 'identifiants distincts');
});

/* ================================================== BOUT EN BOUT (parse) === */
test('une capture réaliste est normalisée sans perte ni invention', () => {
  const w = fresh();
  const r = w.Vision.parse('```json\n' + rep({
    detected: 'Bitstack',
    warnings: ['Le PRU de SOL n\'est pas affiché.'],
    positions: [
      { type: 'crypto', ticker: 'btc', name: 'Bitcoin', quantity: '0,0842', avgPrice: '52 000,50', currency: 'EUR', account: 'Bitstack', confidence: 'haute' },
      { ticker: 'SOL', quantity: 12, avgPrice: null, confidence: 'moyenne' },
      { ticker: '', name: '', quantity: 9 }
    ]
  }) + '\n```');

  assert.strictEqual(r.positions.length, 2, 'la ligne vide est écartée');
  assert.strictEqual(r.detected, 'Bitstack');
  const [btc, sol] = r.positions;
  assert.strictEqual(btc.ticker, 'BTC');
  assert.strictEqual(btc.quantity, 0.0842);
  assert.strictEqual(btc.avgPrice, 52000.5);
  assert.strictEqual(sol.type, 'crypto');
  assert.strictEqual(sol.avgPrice, null, 'un PRU absent n\'est jamais remplacé par un cours');
  assert.strictEqual(sol.name, 'Solana');
});
