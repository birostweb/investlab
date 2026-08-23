/* Tests des fonctions pures du serveur (server/lib/util.js). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const U = require('../server/lib/util');

const sign = body => crypto.createHmac('sha256', 'secret-de-test').update(body).digest('hex');

/* ------------------------------------------------------------- types MIME */
test('mimeFor reconnaît les types servis par l\'application', () => {
  assert.match(U.mimeFor('/x/app.css'), /^text\/css/);
  assert.match(U.mimeFor('index.HTML'), /^text\/html/);
  assert.strictEqual(U.mimeFor('a.woff2'), 'font/woff2');
  assert.strictEqual(U.mimeFor('inconnu.xyz'), 'application/octet-stream');
  assert.strictEqual(U.mimeFor('sans-extension'), 'application/octet-stream');
});

/* -------------------------------------------------------- sécurité chemins */
test('safeJoin résout les chemins normaux sous la racine', () => {
  assert.strictEqual(U.safeJoin('/app/public', '/css/app.css').rel, 'css/app.css');
  assert.strictEqual(U.safeJoin('/app/public', '/').rel, '');
  assert.strictEqual(U.safeJoin('/app/public', '/a/./b').rel, 'a/b');
  assert.strictEqual(U.safeJoin('/app/public', '/a/b/../c').rel, 'a/c');
});

test('safeJoin bloque toutes les formes d\'évasion de répertoire', () => {
  for (const bad of ['/../etc/passwd', '/../../etc/passwd', '/a/../../etc/passwd',
                     '/%2e%2e/%2e%2e/etc/passwd', '\\..\\..\\windows', '/a/\0/b']) {
    assert.strictEqual(U.safeJoin('/app/public', bad), null, 'devrait refuser : ' + bad);
  }
});

test('safeJoin ignore la chaîne de requête et le fragment', () => {
  assert.strictEqual(U.safeJoin('/app/public', '/css/app.css?v=2').rel, 'css/app.css');
  assert.strictEqual(U.safeJoin('/app/public', '/css/app.css#x').rel, 'css/app.css');
});

/* --------------------------------------------------------------- cookies */
test('parseCookies lit un en-tête à plusieurs valeurs', () => {
  const c = U.parseCookies('a=1; mia_session=abc%20def; vide=');
  assert.strictEqual(c.a, '1');
  assert.strictEqual(c.mia_session, 'abc def');
  assert.strictEqual(c.vide, '');
});

test('parseCookies tolère un en-tête absent ou malformé', () => {
  assert.deepStrictEqual(U.parseCookies(undefined), {});
  assert.deepStrictEqual(U.parseCookies(''), {});
  assert.deepStrictEqual(U.parseCookies('sansEgal'), {});
});

test('buildCookie pose toujours les attributs de sécurité', () => {
  const c = U.buildCookie('mia_session', 'v', { maxAge: 60, secure: true });
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Secure/);
  assert.match(c, /Max-Age=60/);
  assert.match(c, /Path=\//);
});

test('buildCookie omet Secure hors HTTPS', () => {
  assert.doesNotMatch(U.buildCookie('a', 'b', { maxAge: 1 }), /Secure/);
});

/* --------------------------------------------------------------- jetons */
test('un jeton signé se relit tel quel', () => {
  const tok = U.encodeToken({ ok: 1, exp: Date.now() + 60000 }, sign);
  assert.strictEqual(U.decodeToken(tok, sign).ok, 1);
});

test('un jeton falsifié est rejeté', () => {
  const tok = U.encodeToken({ ok: 1, exp: Date.now() + 60000 }, sign);
  const flip = s => s.slice(0, -1) + (s.slice(-1) === '0' ? '1' : '0');
  assert.strictEqual(U.decodeToken(flip(tok), sign), null);
});

test('un jeton signé avec un autre secret est rejeté', () => {
  const autre = b => crypto.createHmac('sha256', 'autre').update(b).digest('hex');
  assert.strictEqual(U.decodeToken(U.encodeToken({ ok: 1 }, autre), sign), null);
});

test('un jeton expiré est rejeté', () => {
  const tok = U.encodeToken({ ok: 1, exp: Date.now() - 1 }, sign);
  assert.strictEqual(U.decodeToken(tok, sign), null);
});

test('une charge utile non-jeton est rejetée sans lever', () => {
  for (const bad of [null, undefined, 42, '', 'pasdepoint', '.', 'a.b']) {
    assert.strictEqual(U.decodeToken(bad, sign), null);
  }
});

test('timingSafeEqual compare correctement', () => {
  assert.ok(U.timingSafeEqual('abc', 'abc'));
  assert.ok(!U.timingSafeEqual('abc', 'abd'));
  assert.ok(!U.timingSafeEqual('abc', 'abcd'));
});

test('b64url fait l\'aller-retour, accents compris', () => {
  const s = 'Rééquilibrage — 12 % · €';
  assert.strictEqual(U.b64urlDecode(U.b64urlEncode(s)), s);
  assert.doesNotMatch(U.b64urlEncode(s), /[+/=]/);
});

/* ----------------------------------------------------------------- cache */
test('le cache respecte le TTL', () => {
  const c = U.makeCache();
  c.set('k', { v: 1 });
  assert.deepStrictEqual(c.get('k', 60000), { v: 1 });
  assert.strictEqual(c.get('k', -1), null, 'TTL dépassé → miss');
  assert.strictEqual(c.get('absent', 60000), null);
});

test('getStale rend la valeur périmée pour servir un repli', () => {
  const c = U.makeCache();
  c.set('k', 'vieux');
  assert.strictEqual(c.get('k', -1), null);
  assert.strictEqual(c.getStale('k').value, 'vieux');
});

test('le cache se sérialise et se recharge (persistance disque)', () => {
  const a = U.makeCache();
  a.set('q:CW8', { price: 465 });
  const b = U.makeCache();
  b.load(JSON.parse(JSON.stringify(a.dump())));
  assert.deepStrictEqual(b.get('q:CW8', 60000), { price: 465 });
  assert.strictEqual(b.size(), 1);
});

test('prune supprime les entrées trop vieilles', () => {
  const c = U.makeCache();
  c.load({ vieux: { ts: Date.now() - 40 * 86400e3, value: 1 }, neuf: { ts: Date.now(), value: 2 } });
  assert.strictEqual(c.prune(30 * 86400e3), 1);
  assert.strictEqual(c.size(), 1);
  assert.strictEqual(c.get('neuf', 60000), 2);
});

/* ------------------------------------------------------ limitation de débit */
test('le limiteur laisse passer jusqu\'à la limite puis refuse', () => {
  const lim = U.makeRateLimiter(3, 60000);
  assert.ok(lim('ip').allowed);
  assert.ok(lim('ip').allowed);
  assert.ok(lim('ip').allowed);
  assert.ok(!lim('ip').allowed, '4e tentative refusée');
});

test('le limiteur compte séparément chaque adresse', () => {
  const lim = U.makeRateLimiter(1, 60000);
  assert.ok(lim('a').allowed);
  assert.ok(!lim('a').allowed);
  assert.ok(lim('b').allowed, 'une autre IP n\'est pas pénalisée');
});

/* ------------------------------------------------ espacement des appels API */
test('le throttle sérialise et espace les appels d\'un même fournisseur', async () => {
  const th = U.makeThrottle();
  const t0 = Date.now();
  const ordre = [];
  await Promise.all([
    th('td', 40, async () => ordre.push(1)),
    th('td', 40, async () => ordre.push(2)),
    th('td', 40, async () => ordre.push(3))
  ]);
  assert.deepStrictEqual(ordre, [1, 2, 3], 'ordre préservé');
  assert.ok(Date.now() - t0 >= 70, 'au moins 2 attentes de 40 ms');
});

test('un appel en échec ne bloque pas la file du fournisseur', async () => {
  const th = U.makeThrottle();
  await assert.rejects(th('fh', 1, async () => { throw new Error('HTTP 500'); }));
  assert.strictEqual(await th('fh', 1, async () => 'ok'), 'ok');
});

/* --------------------------------------------------------------- divers */
test('num ne rend jamais NaN ni Infinity', () => {
  assert.strictEqual(U.num('12.5'), 12.5);
  assert.strictEqual(U.num('abc'), null);
  assert.strictEqual(U.num(Infinity), null);
  assert.strictEqual(U.num(null), 0);
});

test('clampInt borne et retombe sur la valeur par défaut', () => {
  assert.strictEqual(U.clampInt('8080', 1, 65535, 3000), 8080);
  assert.strictEqual(U.clampInt('0', 1, 65535, 3000), 1);
  assert.strictEqual(U.clampInt('99999', 1, 65535, 3000), 65535);
  assert.strictEqual(U.clampInt(undefined, 1, 65535, 3000), 3000);
  assert.strictEqual(U.clampInt('abc', 1, 65535, 3000), 3000);
});

test('cleanSymbol n\'accepte qu\'une liste blanche de caractères', () => {
  assert.strictEqual(U.cleanSymbol('cw8'), 'CW8');
  assert.strictEqual(U.cleanSymbol(' mc.pa '), 'MC.PA');
  assert.strictEqual(U.cleanSymbol('BRK-B'), 'BRK-B');
  for (const bad of ['', null, 'A B', 'A/B', "A';DROP", '../etc', 'X'.repeat(21)]) {
    assert.strictEqual(U.cleanSymbol(bad), null, 'devrait refuser : ' + bad);
  }
});
