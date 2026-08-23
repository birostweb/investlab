/* Tests des moteurs d'analyse (public/js/engine.js) et des règles annoncées. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadFront } = require('./_browser-env.js');

// engine.js s'appuie sur G.Market : on charge donc toute la chaîne. Sans
// réseau, market.js rend simplement `null`, ce qui est le cas nominal « aucun
// fournisseur configuré » que les moteurs doivent savoir traiter.
const fresh = () => {
  const w = loadFront(['api.js', 'data.js', 'store.js', 'market.js', 'engine.js']);
  w.Store.load();
  return w;
};
/** Portefeuille de référence, réutilisé par plusieurs tests. */
function garni() {
  const w = fresh();
  w.Store.addHolding({ type: 'etf', ticker: 'IWDA', catalogId: 'IWDA', quantity: 20, avgPrice: 90, lastPrice: 100 });
  w.Store.addHolding({ type: 'action', ticker: 'AAPL', quantity: 10, avgPrice: 150, lastPrice: 200 });
  w.Store.addCash({ label: 'Livret A', amount: 1000 });
  return w;
}

/* ============================================================== ÉCHELLES */
test('scale borne entre 0 et 10 dans les deux sens', () => {
  const E = fresh().Engine;
  assert.strictEqual(E.scale(0.03, 0.6, 0.05), 10, 'des frais sous le seuil « bon » → note maximale');
  assert.strictEqual(E.scale(2, 0.6, 0.05), 0, 'des frais très élevés → note nulle');
  assert.ok(Math.abs(E.scale(0.325, 0.6, 0.05) - 5) < 0.2, 'le milieu vaut ~5');
  assert.strictEqual(E.scale(null, 0, 1), null, 'sans donnée, pas de note');
  assert.strictEqual(E.scale(NaN, 0, 1), null);
});

test('avg ignore les valeurs manquantes et rend null si tout manque', () => {
  const E = fresh().Engine;
  assert.strictEqual(E.avg([2, null, 4, undefined]), 3);
  assert.strictEqual(E.avg([null, undefined]), null);
  assert.strictEqual(E.avg([]), null);
});

/* ============================================================ CONFIANCE */
test('la confiance tombe quand des données manquent, et le dit', () => {
  const E = fresh().Engine;
  const complet = E.confidence([
    { label: 'cours', weight: 2, present: true, asOf: new Date().toISOString() },
    { label: 'frais', weight: 1, present: true, verified: true }
  ]);
  const partiel = E.confidence([
    { label: 'cours', weight: 2, present: false },
    { label: 'frais', weight: 1, present: true, verified: true }
  ]);
  assert.ok(complet.score > partiel.score, 'moins de données → moins de confiance');
  assert.ok(complet.score <= 100 && partiel.score >= 0);
  assert.ok(JSON.stringify(partiel).includes('cours'), 'la donnée absente est nommée');
});

test('une donnée ancienne pèse moins qu\'une donnée fraîche (règle 1)', () => {
  const E = fresh().Engine;
  const vieux = new Date(Date.now() - 900 * 86400e3).toISOString();
  const frais = E.confidence([{ label: 'cours', weight: 1, present: true, asOf: new Date().toISOString() }]);
  const perime = E.confidence([{ label: 'cours', weight: 1, present: true, asOf: vieux }]);
  assert.ok(perime.score < frais.score);
});

/* =========================================================== EXPOSITIONS */
test('exposures décompose les ETF en transparence', () => {
  const w = garni();
  const exp = w.Engine.exposures(w.Store.snapshot());
  assert.ok(Array.isArray(exp.geo) && exp.geo.length > 0, 'des zones géographiques sont produites');
  const somme = exp.geo.reduce((s, g) => s + g.pct, 0);
  assert.ok(somme > 0 && somme <= 100.001, 'les pourcentages restent bornés, reçu ' + somme);
});

test('exposures ne plante pas sur un portefeuille vide', () => {
  const w = fresh();
  const exp = w.Engine.exposures(w.Store.snapshot());
  assert.ok(Array.isArray(exp.geo));
  assert.ok(Array.isArray(exp.sector));
});

/* ========================================================= RÉÉQUILIBRAGE */
test('rebalance chiffre l\'écart à la cible sans rien inventer', () => {
  const w = garni();
  const r = w.Engine.rebalance();
  assert.ok(Array.isArray(r.rows) && r.rows.length === 4);
  for (const row of r.rows) {
    assert.ok(Number.isFinite(row.actual), row.key + '.actual');
    assert.ok(Number.isFinite(row.gap), row.key + '.gap');
    assert.ok(Number.isFinite(row.euroGap), row.key + '.euroGap');
  }
  assert.ok(typeof r.verdict === 'string' && r.verdict.length > 0);
});

test('rebalance reste calculable sur un portefeuille vide', () => {
  const r = fresh().Engine.rebalance();
  r.rows.forEach(row => assert.ok(Number.isFinite(row.euroGap), row.key));
});

/* ============================================================ SIMULATEUR */
test('le simulateur capitalise correctement (contrôle analytique)', () => {
  const s = fresh().Engine.simulate({ initial: 10000, monthly: 0, years: 10, rate: 5, vol: 0 });
  const attendu = 10000 * Math.pow(1.05, 10);
  assert.ok(Math.abs(s.scenarios.central.final - attendu) / attendu < 0.001,
    `attendu ~${attendu.toFixed(0)}, obtenu ${s.scenarios.central.final.toFixed(0)}`);
});

test('le simulateur totalise exactement le capital versé', () => {
  const s = fresh().Engine.simulate({ initial: 1000, monthly: 200, years: 5, rate: 6, vol: 12 });
  assert.strictEqual(s.paid, 1000 + 200 * 60);
  assert.strictEqual(s.months, 60);
});

test('un rendement de 0 % rend exactement le capital versé', () => {
  const s = fresh().Engine.simulate({ initial: 500, monthly: 100, years: 3, rate: 0, vol: 0 });
  assert.ok(Math.abs(s.scenarios.central.final - (500 + 100 * 36)) < 1e-6);
});

test('les scénarios sont correctement ordonnés', () => {
  const s = fresh().Engine.simulate({ initial: 5000, monthly: 150, years: 15 });
  assert.ok(s.scenarios.pess.final < s.scenarios.central.final);
  assert.ok(s.scenarios.central.final < s.scenarios.opti.final);
  assert.ok(s.rates.pess < s.rates.central && s.rates.central < s.rates.opti);
});

test('les percentiles Monte-Carlo sont croissants et finis', () => {
  const s = fresh().Engine.simulate({ initial: 5000, monthly: 150, years: 15 });
  const { p10, p25, p50, p75, p90, runs, lossProb } = s.mc;
  assert.strictEqual(runs, 1500);
  assert.ok(p10 <= p25 && p25 <= p50 && p50 <= p75 && p75 <= p90, 'percentiles ordonnés');
  [p10, p25, p50, p75, p90, lossProb].forEach(v => assert.ok(Number.isFinite(v) && v >= 0));
  assert.ok(lossProb >= 0 && lossProb <= 100);
});

test('le Monte-Carlo est reproductible (même entrée, même sortie)', () => {
  const p = { initial: 1000, monthly: 100, years: 10, rate: 6, vol: 14 };
  assert.strictEqual(fresh().Engine.simulate(p).mc.p50, fresh().Engine.simulate(p).mc.p50);
});

test('une volatilité plus forte élargit la dispersion', () => {
  const E = fresh().Engine;
  const calme = E.simulate({ initial: 1000, monthly: 100, years: 15, rate: 6, vol: 5 });
  const agite = E.simulate({ initial: 1000, monthly: 100, years: 15, rate: 6, vol: 25 });
  assert.ok((agite.mc.p90 - agite.mc.p10) > (calme.mc.p90 - calme.mc.p10));
});

test('le simulateur porte toujours son avertissement (règle 3)', () => {
  const s = fresh().Engine.simulate({ initial: 100, monthly: 10, years: 5 });
  assert.match(s.disclaimer, /pas des prévisions/);
});

/* ============================================================ SCORING ETF */
test('scoreEtf note tout le catalogue sur une échelle bornée', async () => {
  const w = garni();
  const snap = w.Store.snapshot();
  const ctx = { snap, exp: w.Engine.exposures(snap) };
  const notes = [];
  for (const c of Array.from(w.Store.etfCatalog())) {
    notes.push(await w.Engine.scoreEtf(c, ctx, { noNetwork: true }));
  }
  assert.ok(notes.length >= 5, 'le catalogue produit des scores');
  notes.forEach(n => assert.ok(n.score >= 0 && n.score <= 100, 'score hors bornes : ' + n.score));
});

test('scoreEtf : entre deux fonds identiques, le moins cher l\'emporte', async () => {
  const w = garni();
  const snap = w.Store.snapshot();
  const ctx = { snap, exp: w.Engine.exposures(snap) };
  const base = Array.from(w.Store.etfCatalog()).find(c => c.ter != null);
  const cher = await w.Engine.scoreEtf({ ...base, id: 'cher', ter: base.ter + 0.5 }, ctx, { noNetwork: true });
  const bonMarche = await w.Engine.scoreEtf({ ...base, id: 'pascher', ter: 0.05 }, ctx, { noNetwork: true });
  assert.ok(bonMarche.score > cher.score, `${bonMarche.score} devrait dépasser ${cher.score}`);
});

test('rankEtfs classe par score décroissant', async () => {
  const w = garni();
  const { ranked } = await w.Engine.rankEtfs();
  const scores = Array.from(ranked, x => x.score);
  assert.ok(scores.length > 1);
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i - 1] >= scores[i], 'classement décroissant rompu au rang ' + i);
  }
});

test('rankEtfs honore le filtre PEA et la limite', async () => {
  const w = garni();
  const { ranked } = await w.Engine.rankEtfs('pea', 3);
  assert.ok(ranked.length > 0 && ranked.length <= 3);
  Array.from(ranked).forEach(x => assert.ok(x.cat.pea,
    (x.cat.ticker || x.cat.name) + ' n\'est pas éligible PEA'));
});

test('rankEtfs cto exclut les fonds éligibles PEA', async () => {
  const w = garni();
  const { ranked } = await w.Engine.rankEtfs('cto');
  Array.from(ranked).forEach(x => assert.ok(!x.cat.pea, 'fonds PEA trouvé côté CTO'));
});

/* ====================================================== IMMOBILIER (règle 7) */
test('scoreBrick ne classe pas sur le seul rendement annoncé', () => {
  const w = garni();
  const ctx = { snap: w.Store.snapshot() };
  const sage = w.Engine.scoreBrick({ name: 'A', amount: 1000, yieldPct: 8, durationMonths: 12, promoterTrack: 20, ltv: 50 }, ctx);
  const gourmand = w.Engine.scoreBrick({ name: 'B', amount: 1000, yieldPct: 15, durationMonths: 48, promoterTrack: null, ltv: 95 }, ctx);
  assert.ok(sage.score > gourmand.score,
    `un 15 % long et opaque (${gourmand.score}) ne doit pas battre un 8 % court et documenté (${sage.score})`);
  assert.ok(gourmand.risks.length > 0, 'les risques sont explicités');
});

test('un projet en retard est pénalisé', () => {
  const w = garni();
  const ctx = { snap: w.Store.snapshot() };
  const base = { name: 'X', amount: 1000, yieldPct: 9, durationMonths: 24, ltv: 60 };
  const ok = w.Engine.scoreBrick(base, ctx);
  const retard = w.Engine.scoreBrick({ ...base, delayed: true }, ctx);
  assert.ok(retard.score < ok.score);
});

test('un projet peu documenté affiche une confiance basse et ses lacunes (règle 2)', () => {
  const w = garni();
  const s = w.Engine.scoreBrick({ name: 'X', amount: 1000, yieldPct: 9, durationMonths: 12 },
    { snap: w.Store.snapshot() });
  assert.ok(s.confidence.score < 50, 'confiance trop haute : ' + s.confidence.score);
  assert.strictEqual(s.confidence.enough, false, 'trop peu de dimensions pour conclure');
  assert.ok(s.confidence.missing.length > 0, 'les données absentes sont nommées');
});

/* ================================================================ PLAN */
const somme = lignes => Array.from(lignes).reduce((s, l) => s + (Number(l.amount) || 0), 0);

test('buildPlan ne déploie jamais plus que le capital disponible', async () => {
  const w = garni();
  const plan = await w.Engine.buildPlan({ capital: 1000, monthly: 200, horizon: 10 });
  assert.ok(plan.thisMonth.length > 0, 'le plan propose au moins une ligne');
  assert.ok(somme(plan.thisMonth) <= 1000 + 1e-6, 'capital dépassé : ' + somme(plan.thisMonth));
  assert.ok(somme(plan.thisMonth) > 0);
  Array.from(plan.thisMonth).forEach(l => assert.ok(Number.isFinite(l.amount) && l.amount >= 0));
});

test('buildPlan ne déploie jamais plus que le versement mensuel', async () => {
  const w = garni();
  const plan = await w.Engine.buildPlan({ capital: 0, monthly: 300, horizon: 10 });
  assert.ok(somme(plan.recurring) <= 300 + 1e-6, 'versement dépassé : ' + somme(plan.recurring));
});

test('buildPlan sans montant ne propose pas d\'investissement fictif', async () => {
  const w = fresh();
  const plan = await w.Engine.buildPlan({ capital: 0, monthly: 0, horizon: 10 });
  assert.strictEqual(somme(plan.thisMonth), 0);
  assert.strictEqual(somme(plan.recurring), 0);
  assert.ok(plan.notes.some(n => /Aucun montant saisi/.test(n)), 'le plan le dit explicitement');
});

test('buildPlan joint toujours un niveau de confiance expliqué (règle 6)', async () => {
  const w = garni();
  const plan = await w.Engine.buildPlan({ capital: 500, monthly: 100, horizon: 10 });
  assert.ok(plan.confidence.score >= 0 && plan.confidence.score <= 100);
  assert.ok(Array.isArray(plan.confidence.reasons));
});

/* ============================================================== JOURNAL */
test('reviewJournal relit les décisions sans en inventer', async () => {
  const w = garni();
  const vide = await w.Engine.reviewJournal();
  assert.strictEqual(vide.entries.length, 0);
  assert.strictEqual(vide.stats, null, 'aucune statistique inventée sur un journal vide');

  w.Store.addJournal({ asset: 'IWDA', ticker: 'IWDA', assetType: 'etf', priceAtAnalysis: 90, score: 78, decision: 'acheté' });
  const r = await w.Engine.reviewJournal();
  assert.strictEqual(r.entries.length, 1);
  assert.strictEqual(r.entries[0].asset, 'IWDA');
  assert.strictEqual(r.stats, null, 'une décision de moins de 90 jours ne produit pas encore de bilan');
});
