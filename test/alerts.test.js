/* Tests des alertes de prix.
   La règle de déclenchement (public/js/alerts-rules.js) est la SEULE source :
   serveur et navigateur l'appliquent tous les deux. On la teste donc à la
   racine, plus les opérations de stockage. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../public/js/alerts-rules');
const { loadFront } = require('./_browser-env.js');

const veille = (o) => Object.assign(
  { id: 'a', ticker: 'XRP', kind: 'above', price: 2.5, active: true, triggeredAt: null }, o);

/* ============================================================== FRANCHIR === */
test('un seuil « atteint » se déclenche à partir de la valeur exacte', () => {
  assert.strictEqual(R.crosses(veille(), 2.49), false);
  assert.strictEqual(R.crosses(veille(), 2.50), true, 'la valeur exacte compte');
  assert.strictEqual(R.crosses(veille(), 9.99), true);
});

test('un seuil « descend sous » fonctionne dans l\'autre sens', () => {
  const a = veille({ kind: 'below', price: 1500 });
  assert.strictEqual(R.crosses(a, 1501), false);
  assert.strictEqual(R.crosses(a, 1500), true);
  assert.strictEqual(R.crosses(a, 900), true);
});

test('une alerte en pause ou déjà déclenchée ne se redéclenche pas', () => {
  assert.strictEqual(R.crosses(veille({ active: false }), 99), false, 'en pause');
  assert.strictEqual(R.crosses(veille({ triggeredAt: '2026-01-01' }), 99), false, 'déjà déclenchée');
});

test('un prix ou un seuil aberrant ne déclenche jamais', () => {
  for (const p of [null, undefined, 0, -1, NaN, 'beaucoup']) {
    assert.strictEqual(R.crosses(veille(), p), false, 'prix ' + JSON.stringify(p));
  }
  for (const s of [0, -5, null, 'cher']) {
    assert.strictEqual(R.crosses(veille({ price: s }), 10), false, 'seuil ' + JSON.stringify(s));
  }
});

/* ============================================================== ÉVALUER === */
test('evaluate horodate et renvoie les alertes franchies', () => {
  const list = [veille({ id: '1' }), veille({ id: '2', ticker: 'ETH', kind: 'below', price: 1500 })];
  const fired = R.evaluate(list, { XRP: 2.6, ETH: 1400 }, '2026-08-23T10:00:00.000Z');
  assert.strictEqual(fired.length, 2);
  assert.strictEqual(list[0].triggeredPrice, 2.6);
  assert.strictEqual(list[0].triggeredAt, '2026-08-23T10:00:00.000Z');
  assert.strictEqual(list[0].seen, false);
});

test('un cours qui oscille autour du seuil n\'alerte qu\'une fois', () => {
  const list = [veille()];
  assert.strictEqual(R.evaluate(list, { XRP: 2.6 }, 'T1').length, 1);
  assert.strictEqual(R.evaluate(list, { XRP: 2.4 }, 'T2').length, 0);
  assert.strictEqual(R.evaluate(list, { XRP: 2.7 }, 'T3').length, 0, 'pas de second déclenchement');
  assert.strictEqual(list[0].triggeredAt, 'T1', 'le premier horodatage est conservé');
});

test('un ticker sans cours connu est simplement ignoré', () => {
  const list = [veille({ ticker: 'SOL' })];
  assert.strictEqual(R.evaluate(list, {}, 'T').length, 0);
  assert.strictEqual(R.evaluate(list, { SOL: null }, 'T').length, 0);
  assert.strictEqual(list[0].triggeredAt, null);
});

test('evaluate tolère une liste absente ou invalide', () => {
  assert.strictEqual(R.evaluate(null, { XRP: 3 }, 'T').length, 0);
  assert.strictEqual(R.evaluate([null, {}, { ticker: '' }], { XRP: 3 }, 'T').length, 0);
});

/* ============================================================== LIBELLÉ === */
test('describe rend une phrase lisible dans les deux sens', () => {
  const a = veille(); R.evaluate([a], { XRP: 2.6 }, 'T');
  assert.match(R.describe(a), /XRP a atteint/);
  const b = veille({ kind: 'below', price: 1500, ticker: 'ETH' });
  R.evaluate([b], { ETH: 1400 }, 'T');
  assert.match(R.describe(b), /ETH est descendu à/);
});

test('fmt adapte les décimales à l\'ordre de grandeur du jeton', () => {
  assert.strictEqual(R.fmt(0.0512).replace(/ | /g, ' '), '0,0512', 'un jeton à moins d\'un euro');
  assert.strictEqual(R.fmt(2.5).replace(/ | /g, ' '), '2,50');
  assert.strictEqual(R.fmt(66212).replace(/ | /g, ' '), '66 212');
  assert.strictEqual(R.fmt('nimporte quoi'), '—');
});

/* ============================================================ STOCKAGE === */
const fresh = () => {
  const w = loadFront(['data.js', 'store.js']);
  w.Store.load();
  return w;
};

test('une alerte invalide n\'est pas enregistrée', () => {
  const w = fresh();
  assert.strictEqual(w.Store.addAlert({ ticker: 'XRP', price: 0 }), null);
  assert.strictEqual(w.Store.addAlert({ ticker: '', price: 2 }), null);
  assert.strictEqual(w.Store.addAlert({ ticker: 'XRP', price: -3 }), null);
  assert.strictEqual(w.Store.state.alerts.length, 0);
});

test('le ticker est normalisé en majuscules', () => {
  const w = fresh();
  assert.strictEqual(w.Store.addAlert({ ticker: 'xrp', price: 2.5 }).ticker, 'XRP');
});

test('réarmer une alerte la remet en veille', () => {
  const w = fresh();
  const a = w.Store.addAlert({ ticker: 'XRP', price: 2.5 });
  R.evaluate(w.Store.state.alerts, { XRP: 3 }, 'T');
  assert.ok(w.Store.state.alerts[0].triggeredAt);
  w.Store.rearmAlert(a.id);
  assert.strictEqual(w.Store.state.alerts[0].triggeredAt, null);
  assert.strictEqual(w.Store.state.alerts[0].triggeredPrice, null);
  assert.strictEqual(R.crosses(w.Store.state.alerts[0], 3), true, 'de nouveau armée');
});

test('pendingAlerts ne liste que le déclenché non lu', () => {
  const w = fresh();
  w.Store.addAlert({ ticker: 'XRP', price: 2.5 });
  w.Store.addAlert({ ticker: 'ETH', price: 5000 });
  assert.strictEqual(w.Store.pendingAlerts().length, 0);
  R.evaluate(w.Store.state.alerts, { XRP: 3 }, 'T');
  assert.strictEqual(w.Store.pendingAlerts().length, 1);
  assert.strictEqual(w.Store.markAlertsSeen(), 1);
  assert.strictEqual(w.Store.pendingAlerts().length, 0, 'plus rien après lecture');
});

test('supprimer une alerte la retire de l\'état', () => {
  const w = fresh();
  const a = w.Store.addAlert({ ticker: 'XRP', price: 2.5 });
  w.Store.removeAlert(a.id);
  assert.strictEqual(w.Store.state.alerts.length, 0);
});

test('les alertes survivent à un export/import', () => {
  const w = fresh();
  w.Store.addAlert({ ticker: 'XRP', price: 2.5, note: 'vendre une partie' });
  const w2 = fresh();
  w2.Store.importJSON(w.Store.exportJSON());
  assert.strictEqual(w2.Store.state.alerts.length, 1);
  assert.strictEqual(w2.Store.state.alerts[0].note, 'vendre une partie');
});
