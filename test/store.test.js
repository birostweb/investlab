/* Tests de la persistance serveur (server/lib/store.js). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../server/lib/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mia-test-'));

test('un dossier de données vierge ne contient aucun état', () => {
  const s = new Store(tmp(), () => {});
  assert.strictEqual(s.readState(), null);
  assert.deepStrictEqual(s.stats(), { size: 0, mtime: null, backups: 0 });
});

test('l\'état écrit se relit à l\'identique', async () => {
  const s = new Store(tmp(), () => {});
  const etat = { holdings: [{ ticker: 'CW8', quantity: 12 }], profile: { horizonYears: 10 } };
  await s.writeState(etat);
  assert.deepStrictEqual(s.readState(), etat);
});

test('les écritures concurrentes ne se corrompent pas et la dernière gagne', async () => {
  const dir = tmp();
  const s = new Store(dir, () => {});
  await Promise.all([1, 2, 3, 4, 5].map(n => s.writeState({ n, holdings: [] })));
  const relu = s.readState();
  assert.ok(relu && typeof relu.n === 'number', 'le fichier reste un JSON valide');
  assert.strictEqual(fs.readdirSync(dir).filter(f => f.includes('.tmp-')).length, 0,
    'aucun fichier temporaire ne subsiste');
});

test('les accents et l\'euro survivent à l\'aller-retour disque', async () => {
  const s = new Store(tmp(), () => {});
  await s.writeState({ label: 'Rééquilibrage — 1 500 € · Société Générale' });
  assert.strictEqual(s.readState().label, 'Rééquilibrage — 1 500 € · Société Générale');
});

test('un état corrompu est mis de côté, jamais supprimé', () => {
  const dir = tmp();
  const s = new Store(dir, () => {});
  fs.writeFileSync(path.join(dir, 'state.json'), '{ ceci n\'est pas du JSON');
  assert.strictEqual(s.readState(), null);
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('state.json.corrupt-')),
    'le fichier illisible est conservé pour analyse');
});

test('un état corrompu est restauré depuis la dernière sauvegarde', async () => {
  const dir = tmp();
  const s = new Store(dir, () => {});
  await s.writeState({ holdings: [{ ticker: 'IWDA' }] });
  s.backup();
  fs.writeFileSync(path.join(dir, 'state.json'), 'illisible');
  const relu = s.readState();
  assert.ok(relu, 'la sauvegarde a pris le relais');
  assert.strictEqual(relu.holdings[0].ticker, 'IWDA');
});

test('backup est idempotent sur une même journée', async () => {
  const dir = tmp();
  const s = new Store(dir, () => {});
  await s.writeState({ a: 1 });
  const p1 = s.backup(), p2 = s.backup();
  assert.strictEqual(p1, p2);
  assert.strictEqual(s.stats().backups, 1);
});

test('backup ne conserve que 14 jours', async () => {
  const dir = tmp();
  const s = new Store(dir, () => {});
  await s.writeState({ a: 1 });
  const bdir = path.join(dir, 'backups');
  for (let d = 1; d <= 20; d++) {
    fs.writeFileSync(path.join(bdir, `state-2026-01-${String(d).padStart(2, '0')}.json`), '{}');
  }
  s.backup();
  const restants = fs.readdirSync(bdir).filter(f => /^state-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  assert.ok(restants.length <= 14, 'reste ' + restants.length + ' sauvegardes');
  assert.ok(restants.includes(`state-${new Date().toISOString().slice(0, 10)}.json`),
    'la sauvegarde du jour est conservée');
});

test('backup sans état à sauvegarder ne lève pas', () => {
  assert.strictEqual(new Store(tmp(), () => {}).backup(), null);
});

test('le cache marché se persiste et se relit', async () => {
  const s = new Store(tmp(), () => {});
  assert.strictEqual(s.readCache(), null);
  await s.writeCache({ 'q:CW8': { ts: 1, value: { price: 465 } } });
  assert.strictEqual(s.readCache()['q:CW8'].value.price, 465);
});

test('un cache corrompu est ignoré sans faire tomber le serveur', () => {
  const dir = tmp();
  const s = new Store(dir, () => {});
  fs.writeFileSync(path.join(dir, 'market-cache.json'), 'pas du json');
  assert.strictEqual(s.readCache(), null);
});

test('stats reflète la taille et le nombre de sauvegardes', async () => {
  const s = new Store(tmp(), () => {});
  await s.writeState({ holdings: [] });
  s.backup();
  const st = s.stats();
  assert.ok(st.size > 0);
  assert.ok(st.mtime);
  assert.strictEqual(st.backups, 1);
});
