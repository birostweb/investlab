/* Tests des statistiques calculées sur les historiques (server/lib/providers.js). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { computeStats, sampleSeries } = require('../server/lib/providers');

/** Série synthétique : n clôtures croissant à taux constant. */
function serie(n, depart, tauxJournalier) {
  const out = [];
  let c = depart;
  for (let i = 0; i < n; i++) {
    out.push({ d: '2020-01-' + String((i % 28) + 1).padStart(2, '0'), c });
    c *= 1 + tauxJournalier;
  }
  return out;
}

test('une série sans variation a une volatilité nulle', () => {
  const s = computeStats(serie(300, 100, 0));
  assert.strictEqual(s.volAnn, 0);
  assert.strictEqual(s.maxDD, 0, 'aucune baisse');
  assert.ok(Math.abs(s.cagr) < 1e-9);
});

test('le CAGR d\'une croissance régulière est exact', () => {
  // 252 séances à +0,05 %/j ≈ (1,0005^252 - 1) sur un an
  const s = computeStats(serie(253, 100, 0.0005));
  const attendu = (Math.pow(1.0005, 252) - 1) * 100;
  assert.ok(Math.abs(s.cagr - attendu) < 0.5, `attendu ~${attendu.toFixed(2)}, obtenu ${s.cagr.toFixed(2)}`);
});

test('le drawdown maximal est négatif et mesuré depuis le sommet', () => {
  const closes = [100, 120, 60, 90].map((c, i) => ({ d: '2020-01-0' + (i + 1), c }));
  const s = computeStats(closes);
  assert.ok(Math.abs(s.maxDD - (-50)) < 1e-9, '120 → 60 = -50 %, obtenu ' + s.maxDD);
});

test('les performances glissantes sont nulles quand l\'historique est trop court', () => {
  const s = computeStats(serie(100, 100, 0.001));
  assert.ok(s.perf1m !== null, '1 mois disponible sur 100 séances');
  assert.strictEqual(s.perf1y, null, 'un an de recul n\'existe pas');
  assert.strictEqual(s.perf5y, null);
  assert.strictEqual(s.cagr, null, 'moins d\'un an : pas de CAGR annualisé');
});

test('computeStats ne rend jamais NaN sur une série dégénérée', () => {
  const s = computeStats([{ d: '2020-01-01', c: 100 }]);
  for (const k of ['volAnn', 'maxDD', 'last', 'first', 'points']) {
    assert.ok(Number.isFinite(s[k]), k + ' = ' + s[k]);
  }
});

test('sampleSeries réduit la série en gardant la dernière clôture', () => {
  const src = serie(1300, 100, 0.0003);
  const out = sampleSeries(src, 200);
  assert.ok(out.length <= 201, 'échantillon de ' + out.length + ' points');
  assert.strictEqual(out[out.length - 1].c, src[src.length - 1].c, 'le dernier point est préservé');
  assert.strictEqual(out[0].c, src[0].c, 'le premier point est préservé');
});

test('sampleSeries laisse intacte une série déjà courte', () => {
  const src = serie(50, 100, 0.001);
  assert.strictEqual(sampleSeries(src, 200).length, 50);
});
