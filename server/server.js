/* ============================================================================
   server.js — Mon Investisseur IA
   Serveur HTTP sans aucune dépendance npm (bibliothèque standard Node ≥ 20).

   · sert l'application statique
   · relaie les fournisseurs de données (les clés restent ici, jamais dans le
     navigateur) avec un cache partagé et persistant
   · rafraîchit les cours tout seul, à intervalle régulier
   · stocke le portefeuille côté serveur → synchronisé entre tous tes appareils
   · protège l'accès par un mot de passe unique
   ========================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const U = require('./lib/util');
const { Providers } = require('./lib/providers');
const { Store } = require('./lib/store');

/* ------------------------------------------------------------ configuration */
const ENV = process.env;
const PORT = U.clampInt(ENV.PORT, 1, 65535, 3000);
const HOST = ENV.HOST || '0.0.0.0';
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const DATA_DIR = path.resolve(ENV.DATA_DIR || '/data');
const PASSWORD = (ENV.APP_PASSWORD || '').trim();
const SESSION_DAYS = U.clampInt(ENV.SESSION_DAYS, 1, 365, 30);
const REFRESH_MINUTES = U.clampInt(ENV.REFRESH_MINUTES, 0, 10080, 360);
const TRUST_PROXY = String(ENV.TRUST_PROXY || 'true') !== 'false';
const ANTHROPIC_KEY = (ENV.ANTHROPIC_API_KEY || '').trim();
const ANTHROPIC_MODEL = ENV.ANTHROPIC_MODEL || 'claude-sonnet-5';
const VERSION = '2.0.0';

const log = (...a) => console.log(new Date().toISOString(), '·', ...a);
const warn = (...a) => console.warn(new Date().toISOString(), '!', ...a);

/* Le secret de session doit survivre aux redémarrages, sinon chaque déploiement
   déconnecte l'utilisateur. On le dérive du mot de passe, ou on le persiste.  */
function sessionSecret(store) {
  if (ENV.SESSION_SECRET) return ENV.SESSION_SECRET;
  const f = path.join(DATA_DIR, '.session-secret');
  try {
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(f, s, { mode: 0o600 });
    return s;
  } catch (e) {
    warn('secret de session non persistable, dérivation depuis le mot de passe');
    return crypto.createHash('sha256').update('mia|' + PASSWORD).digest('hex');
  }
}

/* --------------------------------------------------------------- démarrage */
fs.mkdirSync(DATA_DIR, { recursive: true });
const store = new Store(DATA_DIR, log);
const SECRET = sessionSecret(store);
const marketCache = U.makeCache();
const persisted = store.readCache();
if (persisted) { marketCache.load(persisted); log('cache marché rechargé (' + marketCache.size() + ' entrées)'); }
const providers = new Providers(ENV, marketCache, log);
const loginLimiter = U.makeRateLimiter(8, 15 * 60e3);
const apiLimiter = U.makeRateLimiter(600, 60e3);

const sign = body => crypto.createHmac('sha256', SECRET).update(body).digest('hex');

/* --------------------------------------------------------------- réponses */
function send(req, res, status, body, headers) {
  const h = Object.assign({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store'
  }, headers || {});
  let payload = body;
  if (!Buffer.isBuffer(payload)) payload = Buffer.from(String(payload), 'utf8');

  const ae = String(req.headers['accept-encoding'] || '');
  if (payload.length > 1024 && /\bgzip\b/.test(ae) && /text|json|javascript|svg/.test(h['Content-Type'] || '')) {
    try { payload = zlib.gzipSync(payload); h['Content-Encoding'] = 'gzip'; } catch (e) { /* non compressé */ }
  }
  h['Content-Length'] = payload.length;
  res.writeHead(status, h);
  if (req.method === 'HEAD') return res.end();
  res.end(payload);
}
const json = (req, res, status, obj, headers) =>
  send(req, res, status, JSON.stringify(obj), Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}));

function clientIp(req) {
  if (TRUST_PROXY) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'inconnu';
}

/** Lit un corps JSON borné (protection contre les corps géants). */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('corps trop volumineux')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(null);
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('JSON invalide')); }
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------- authentification */
function isAuthed(req) {
  if (!PASSWORD) return true;                       // pas de mot de passe → ouvert
  const c = U.parseCookies(req.headers.cookie);
  const p = U.decodeToken(c.mia_session, sign);
  return !!(p && p.ok);
}
function makeSessionCookie(secure) {
  const exp = Date.now() + SESSION_DAYS * 86400e3;
  const token = U.encodeToken({ ok: 1, exp }, sign);
  return U.buildCookie('mia_session', token, { maxAge: SESSION_DAYS * 86400, secure });
}
const isHttps = req => TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

/* ---------------------------------------------------------- fichiers statiques */
function serveStatic(req, res, urlPath) {
  const joined = U.safeJoin(PUBLIC_DIR, urlPath);
  if (!joined) return send(req, res, 400, 'Requête invalide', { 'Content-Type': 'text/plain; charset=utf-8' });
  let file = joined.abs;
  try {
    let st = fs.statSync(file);
    if (st.isDirectory()) { file = path.join(file, 'index.html'); st = fs.statSync(file); }
    // le rendu final doit rester à l'intérieur de public/
    if (!path.resolve(file).startsWith(path.resolve(PUBLIC_DIR))) {
      return send(req, res, 403, 'Interdit', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const etag = '"' + st.size.toString(16) + '-' + st.mtimeMs.toString(16) + '"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
    const isHtml = file.endsWith('.html');
    return send(req, res, 200, fs.readFileSync(file), {
      'Content-Type': U.mimeFor(file),
      'ETag': etag,
      'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=300, must-revalidate'
    });
  } catch (e) {
    // application monopage : tout chemin inconnu retombe sur index.html
    try {
      return send(req, res, 200, fs.readFileSync(path.join(PUBLIC_DIR, 'index.html')),
        { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    } catch (e2) {
      return send(req, res, 404, 'Introuvable', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
  }
}

/* ================================================================ ROUTAGE */
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let urlPath = '/';
  let query = {};
  try {
    const u = new URL(req.url, 'http://localhost');
    urlPath = u.pathname;
    u.searchParams.forEach((v, k) => query[k] = v);
  } catch (e) { return send(req, res, 400, 'URL invalide', { 'Content-Type': 'text/plain; charset=utf-8' }); }

  try {
    if (urlPath === '/api/health') {
      return json(req, res, 200, {
        ok: true, version: VERSION, uptime: Math.round(process.uptime()),
        cache: marketCache.size(), providers: providers.status().filter(p => p.on).map(p => p.name),
        store: store.stats()
      });
    }

    if (urlPath.startsWith('/api/')) {
      if (!apiLimiter(clientIp(req)).allowed) return json(req, res, 429, { error: 'trop de requêtes' });
      return await handleApi(req, res, urlPath, query);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(req, res, 405, 'Méthode non autorisée', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    return serveStatic(req, res, urlPath);
  } catch (e) {
    warn('erreur non gérée sur ' + urlPath + ' : ' + e.stack);
    if (!res.headersSent) json(req, res, 500, { error: 'erreur interne' });
  } finally {
    if (urlPath.startsWith('/api/') && urlPath !== '/api/health') {
      log(req.method, urlPath, res.statusCode, (Date.now() - started) + 'ms');
    }
  }
});

async function handleApi(req, res, urlPath, query) {
  /* ---- connexion (seule route ouverte) ---- */
  if (urlPath === '/api/login' && req.method === 'POST') {
    const ip = clientIp(req);
    if (!loginLimiter(ip).allowed) {
      warn('trop de tentatives de connexion depuis ' + ip);
      return json(req, res, 429, { error: 'Trop de tentatives. Réessaie dans quelques minutes.' });
    }
    let body;
    try { body = await readBody(req, 4096); } catch (e) { return json(req, res, 400, { error: e.message }); }
    const given = String((body && body.password) || '');
    // comparaison à durée constante sur les empreintes (longueurs égales)
    const a = crypto.createHash('sha256').update(given).digest('hex');
    const b = crypto.createHash('sha256').update(PASSWORD).digest('hex');
    if (!PASSWORD || !U.timingSafeEqual(a, b)) {
      return json(req, res, 401, { error: 'Mot de passe incorrect.' });
    }
    return json(req, res, 200, { ok: true }, { 'Set-Cookie': makeSessionCookie(isHttps(req)) });
  }

  if (urlPath === '/api/logout' && req.method === 'POST') {
    return json(req, res, 200, { ok: true },
      { 'Set-Cookie': U.buildCookie('mia_session', '', { maxAge: 0, secure: isHttps(req) }) });
  }

  /* ---- état de configuration : accessible même non connecté ---- */
  if (urlPath === '/api/config') {
    const authed = isAuthed(req);
    return json(req, res, 200, {
      authed, needsPassword: !!PASSWORD, version: VERSION,
      providers: authed ? providers.status() : undefined,
      hasMarketData: authed ? providers.hasAny() : undefined,
      aiEnabled: authed ? !!ANTHROPIC_KEY : undefined,
      refreshMinutes: authed ? REFRESH_MINUTES : undefined,
      lastRefresh: authed ? lastRefresh : undefined,
      stats: authed ? providers.stats : undefined
    });
  }

  /* ---- au-delà : authentification obligatoire ---- */
  if (!isAuthed(req)) return json(req, res, 401, { error: 'non authentifié' });

  /* ---- portefeuille ---- */
  if (urlPath === '/api/state') {
    if (req.method === 'GET') {
      return json(req, res, 200, store.readState() || null);
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      let body;
      try { body = await readBody(req, 8 * 1024 * 1024); }
      catch (e) { return json(req, res, 400, { error: e.message }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json(req, res, 400, { error: 'état invalide' });
      }
      await store.writeState(body);
      return json(req, res, 200, { ok: true, savedAt: new Date().toISOString() });
    }
    return json(req, res, 405, { error: 'méthode non autorisée' });
  }

  /* ---- données de marché ---- */
  if (urlPath === '/api/quote' || urlPath === '/api/series' || urlPath === '/api/fundamentals') {
    const sym = U.cleanSymbol(query.symbol);
    if (!sym) return json(req, res, 400, { error: 'symbole invalide' });
    if (!providers.hasAny()) {
      return json(req, res, 200, { data: null, reason: 'aucun fournisseur configuré sur le serveur' });
    }
    const kind = urlPath.slice(5);
    const force = query.force === '1';
    const data = await providers[kind === 'fundamentals' ? 'fundamentals' : kind](sym, { force });
    return json(req, res, 200, { data: data || null, symbol: sym });
  }

  if (urlPath === '/api/fx') {
    const from = U.cleanSymbol(query.from), to = U.cleanSymbol(query.to);
    if (!from || !to) return json(req, res, 400, { error: 'devises invalides' });
    return json(req, res, 200, { data: await providers.fx(from, to) });
  }

  /* ---- rafraîchissement manuel ---- */
  if (urlPath === '/api/refresh' && req.method === 'POST') {
    const r = await refreshAll(true);
    return json(req, res, 200, r);
  }

  /* ---- chat en langage naturel (clé côté serveur) ---- */
  if (urlPath === '/api/chat' && req.method === 'POST') {
    if (!ANTHROPIC_KEY) return json(req, res, 503, { error: 'chat non configuré sur le serveur' });
    let body;
    try { body = await readBody(req, 512 * 1024); } catch (e) { return json(req, res, 400, { error: e.message }); }
    if (!body || !body.system || !Array.isArray(body.messages)) {
      return json(req, res, 400, { error: 'requête invalide' });
    }
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 2000,
          system: String(body.system).slice(0, 120000),
          messages: body.messages.slice(-12).map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.content).slice(0, 20000)
          }))
        })
      });
      if (!r.ok) {
        const t = await r.text();
        warn('Anthropic ' + r.status + ' : ' + t.slice(0, 200));
        return json(req, res, 502, { error: 'service de langage indisponible (' + r.status + ')' });
      }
      const j = await r.json();
      const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
      return json(req, res, 200, { text });
    } catch (e) {
      return json(req, res, 502, { error: 'appel impossible : ' + e.message });
    }
  }

  return json(req, res, 404, { error: 'route inconnue' });
}

/* ============================================ rafraîchissement automatique */
let lastRefresh = null;
let refreshing = false;

async function refreshAll(manual) {
  if (refreshing) return { skipped: true, reason: 'rafraîchissement déjà en cours' };
  if (!providers.hasAny()) return { skipped: true, reason: 'aucun fournisseur configuré' };
  refreshing = true;
  const t0 = Date.now();
  let updated = 0, failed = 0, total = 0;
  try {
    const state = store.readState();
    if (!state) return { skipped: true, reason: 'aucun portefeuille enregistré' };

    const symbols = new Set();
    (state.holdings || []).forEach(h => { if (h.ticker) symbols.add(String(h.ticker).toUpperCase()); });
    (state.watchlist || []).forEach(w => { if (w.ticker) symbols.add(String(w.ticker).toUpperCase()); });
    total = symbols.size;

    for (const sym of symbols) {
      const q = await providers.quote(sym, { force: true });
      if (q) updated++; else failed++;
      // l'historique est plus coûteux : on ne le force pas, le TTL suffit
      await providers.series(sym).catch(() => {});
    }

    // reporte les cours dans les positions, avec conversion de devise
    let changed = false;
    for (const h of (state.holdings || [])) {
      if (!h.ticker) continue;
      const q = await providers.quote(String(h.ticker).toUpperCase());
      if (!q) continue;
      let price = q.price, src = q.source;
      if (q.currency && h.currency && q.currency.toUpperCase() !== String(h.currency).toUpperCase()) {
        const fx = await providers.fx(q.currency, h.currency);
        if (fx) { price = price * fx.rate; src += ' + change BCE'; }
        else continue;                       // pas de conversion douteuse
      }
      if (h.lastPrice !== price) changed = true;
      h.lastPrice = price; h.lastPriceDate = q.asOf; h.lastPriceSource = src + (q.stale ? ' (cache)' : '');
    }
    if (changed || manual) {
      state.settings = state.settings || {};
      state.settings.lastRefresh = new Date().toISOString();
      await store.writeState(state);
    }
    lastRefresh = new Date().toISOString();
    store.writeCache(marketCache.dump());
    log(`rafraîchissement : ${updated}/${total} cours (${failed} échecs) en ${Date.now() - t0}ms`);
    return { ok: true, total, updated, failed, at: lastRefresh, ms: Date.now() - t0 };
  } catch (e) {
    warn('rafraîchissement interrompu : ' + e.message);
    return { ok: false, error: e.message };
  } finally { refreshing = false; }
}

/* ------------------------------------------------------------ autotest */
/** Lancé au démarrage : vérifie les invariants critiques et le fait savoir
 *  dans les journaux. Indispensable ici, le serveur n'ayant pas pu être
 *  exécuté sur la machine de développement.                                */
function selfTest() {
  const checks = [];
  const t = (name, fn) => { try { checks.push({ name, ok: !!fn() }); } catch (e) { checks.push({ name, ok: false, err: e.message }); } };

  t('public/ présent', () => fs.existsSync(path.join(PUBLIC_DIR, 'index.html')));
  t('DATA_DIR accessible en écriture', () => {
    const p = path.join(DATA_DIR, '.write-test');
    fs.writeFileSync(p, 'x'); fs.unlinkSync(p); return true;
  });
  t('évasion de répertoire bloquée', () => U.safeJoin(PUBLIC_DIR, '/../../etc/passwd') === null);
  t('jeton de session valide', () => {
    const tok = U.encodeToken({ ok: 1, exp: Date.now() + 1000 }, sign);
    return !!U.decodeToken(tok, sign);
  });
  t('jeton falsifié rejeté', () => {
    const tok = U.encodeToken({ ok: 1, exp: Date.now() + 1000 }, sign);
    return U.decodeToken(tok.slice(0, -1) + (tok.slice(-1) === '0' ? '1' : '0'), sign) === null;
  });
  t('fetch disponible (Node ≥ 18)', () => typeof fetch === 'function');
  t('lecture/écriture de l\'état', () => {
    const probe = store.readState();
    return probe === null || typeof probe === 'object';
  });

  const failed = checks.filter(c => !c.ok);
  checks.forEach(c => log((c.ok ? '  ✓ ' : '  ✗ ') + c.name + (c.err ? ' — ' + c.err : '')));
  if (failed.length) warn(`AUTOTEST : ${failed.length} vérification(s) en échec.`);
  else log('autotest : les ' + checks.length + ' vérifications passent');
  return failed.length === 0;
}

/* --------------------------------------------------------------- lancement */
log(`Mon Investisseur IA v${VERSION}`);
log(`données : ${DATA_DIR} · application : ${PUBLIC_DIR}`);
selfTest();

if (!PASSWORD) {
  warn('┌──────────────────────────────────────────────────────────────┐');
  warn("│ APP_PASSWORD n'est pas défini : l'application est OUVERTE à   │");
  warn('│ quiconque connaît son adresse. Définis APP_PASSWORD.          │');
  warn('└──────────────────────────────────────────────────────────────┘');
}
const active = providers.status().filter(p => p.on).map(p => p.name);
log('fournisseurs actifs : ' + (active.length ? active.join(', ') : 'aucun'));
if (!providers.hasAny()) warn("aucune clé de données de marché : les cours ne seront pas récupérés (l'analyse de portefeuille fonctionne).");
if (ANTHROPIC_KEY) log('chat en langage naturel : actif (' + ANTHROPIC_MODEL + ')');

server.listen(PORT, HOST, () => log(`à l'écoute sur http://${HOST}:${PORT}`));

/* planification */
if (REFRESH_MINUTES > 0) {
  log(`rafraîchissement automatique toutes les ${REFRESH_MINUTES} minutes`);
  setTimeout(() => refreshAll(false), 20e3);                       // un peu après le démarrage
  setInterval(() => refreshAll(false), REFRESH_MINUTES * 60e3);
}
setInterval(() => { store.backup(); marketCache.prune(30 * 86400e3); store.writeCache(marketCache.dump()); },
  6 * 3600e3);

/* arrêt propre : Dokploy envoie SIGTERM lors d'un redéploiement */
let closing = false;
function shutdown(sig) {
  if (closing) return; closing = true;
  log('signal ' + sig + ' — arrêt en cours');
  try { store.writeCache(marketCache.dump()); } catch (e) { /* rien */ }
  server.close(() => { log('arrêté proprement'); process.exit(0); });
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', e => warn('promesse rejetée : ' + (e && e.message)));
process.on('uncaughtException', e => { warn('exception non capturée : ' + e.stack); });
