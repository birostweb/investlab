/* ============================================================================
   util.js — Fonctions pures du serveur.
   Volontairement sans aucun import Node : ce fichier peut être chargé tel quel
   dans un navigateur pour être testé, ce qui permet de le vérifier même sans
   runtime Node sur la machine de développement.
   ========================================================================== */
'use strict';

/* ------------------------------------------------------------------ types */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
function mimeFor(path) {
  const i = String(path).lastIndexOf('.');
  return (i >= 0 && MIME[String(path).slice(i).toLowerCase()]) || 'application/octet-stream';
}

/* ------------------------------------------------------- sécurité chemins */
/** Empêche toute évasion hors du dossier public (../, encodages, absolus). */
function safeJoin(root, urlPath) {
  let p;
  try { p = decodeURIComponent(String(urlPath).split('?')[0].split('#')[0]); }
  catch (e) { return null; }
  p = p.replace(/\\/g, '/');
  if (p.indexOf('\0') >= 0) return null;
  const parts = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); continue; }
    parts.push(seg);
  }
  return { rel: parts.join('/'), abs: root.replace(/[\/\\]+$/, '') + '/' + parts.join('/') };
}

/* --------------------------------------------------------------- cookies */
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  String(header).split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    if (!k) return;
    let v = part.slice(i + 1).trim();
    try { v = decodeURIComponent(v); } catch (e) { /* valeur brute */ }
    out[k] = v;
  });
  return out;
}
function buildCookie(name, value, opts) {
  opts = opts || {};
  let s = `${name}=${encodeURIComponent(value)}`;
  s += `; Path=${opts.path || '/'}`;
  s += `; HttpOnly`;
  s += `; SameSite=${opts.sameSite || 'Lax'}`;
  if (opts.secure) s += `; Secure`;
  if (opts.maxAge !== undefined) s += `; Max-Age=${Math.floor(opts.maxAge)}`;
  return s;
}

/* -------------------------------------------------------------- jetons */
/** Jeton = base64url(payload).signatureHex — signature fournie par l'appelant
 *  (HMAC côté Node) pour garder ce module dépourvu d'import.               */
function encodeToken(payloadObj, signFn) {
  const body = b64urlEncode(JSON.stringify(payloadObj));
  return body + '.' + signFn(body);
}
function decodeToken(token, signFn, now) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const i = token.lastIndexOf('.');
  const body = token.slice(0, i), sig = token.slice(i + 1);
  if (!body || !sig) return null;
  const expect = signFn(body);
  if (!timingSafeEqual(sig, expect)) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(body)); } catch (e) { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (payload.exp && (now || Date.now()) > payload.exp) return null;
  return payload;
}
/** Comparaison à durée constante sur des chaînes hexadécimales. */
function timingSafeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function b64urlEncode(str) {
  const b64 = (typeof Buffer !== 'undefined')
    ? Buffer.from(str, 'utf8').toString('base64')
    : btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  let b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return (typeof Buffer !== 'undefined')
    ? Buffer.from(b64, 'base64').toString('utf8')
    : decodeURIComponent(escape(atob(b64)));
}

/* ------------------------------------------------------------ cache TTL */
function makeCache() {
  const map = new Map();
  return {
    get(key, ttlMs) {
      const e = map.get(key);
      if (!e) return null;
      if (ttlMs && (Date.now() - e.ts) > ttlMs) return null;
      return e.value;
    },
    /** Renvoie la valeur même périmée : sert de repli si le fournisseur tombe. */
    getStale(key) { const e = map.get(key); return e ? { value: e.value, ts: e.ts } : null; },
    set(key, value) { map.set(key, { ts: Date.now(), value }); return value; },
    delete(key) { map.delete(key); },
    size() { return map.size; },
    dump() { const o = {}; map.forEach((v, k) => o[k] = v); return o; },
    load(obj) {
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach(k => {
        const e = obj[k];
        if (e && typeof e.ts === 'number') map.set(k, { ts: e.ts, value: e.value });
      });
    },
    /** Supprime les entrées plus vieilles que maxAgeMs. */
    prune(maxAgeMs) {
      const cut = Date.now() - maxAgeMs;
      let n = 0;
      map.forEach((v, k) => { if (v.ts < cut) { map.delete(k); n++; } });
      return n;
    }
  };
}

/* --------------------------------------------- limitation de débit simple */
/** Fenêtre glissante par clé (adresse IP). */
function makeRateLimiter(limit, windowMs) {
  const hits = new Map();
  return function check(key) {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 5000) hits.clear();          // garde-fou mémoire
    return { allowed: arr.length <= limit, remaining: Math.max(0, limit - arr.length) };
  };
}

/* ---------------------------------------------- espacement des appels API */
/** Sérialise les appels d'un fournisseur avec un intervalle minimum. */
function makeThrottle() {
  const lanes = {};
  return function run(lane, minGapMs, fn) {
    if (!lanes[lane]) lanes[lane] = { last: 0, chain: Promise.resolve() };
    const L = lanes[lane];
    const p = L.chain.then(async () => {
      const wait = Math.max(0, minGapMs - (Date.now() - L.last));
      if (wait) await new Promise(r => setTimeout(r, wait));
      L.last = Date.now();
      return fn();
    });
    // la chaîne ne doit jamais rester rejetée, sinon la file se bloque
    L.chain = p.then(() => undefined, () => undefined);
    return p;
  };
}

/* ------------------------------------------------------------- divers */
function num(v) { const n = Number(v); return isFinite(n) ? n : null; }
function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (!isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}
/** Symbole de marché : lettres, chiffres, point, tiret, deux-points. */
function cleanSymbol(s) {
  const t = String(s || '').trim().toUpperCase();
  return /^[A-Z0-9.\-:]{1,20}$/.test(t) ? t : null;
}
function isoDate(d) { return new Date(d || Date.now()).toISOString().slice(0, 10); }

const API = {
  MIME, mimeFor, safeJoin, parseCookies, buildCookie,
  encodeToken, decodeToken, timingSafeEqual, b64urlEncode, b64urlDecode,
  makeCache, makeRateLimiter, makeThrottle, num, clampInt, cleanSymbol, isoDate
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.ServerUtil = API;
