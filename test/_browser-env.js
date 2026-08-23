/* ============================================================================
   _browser-env.js — Charge les modules front (public/js/*.js) dans Node.

   Ces fichiers sont écrits pour le navigateur : ils s'attachent à `window`.
   On leur fournit ici le strict minimum (window, localStorage, document) pour
   pouvoir tester la logique pure — calculs de portefeuille, scoring, moteurs —
   sans navigateur ni serveur.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUB = path.resolve(__dirname, '..', 'public', 'js');

/** Un localStorage minimal, en mémoire. */
function memStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => m.set(String(k), String(v)),
    removeItem: k => m.delete(String(k)),
    clear: () => m.clear()
  };
}

/**
 * Crée un contexte navigateur et y charge les modules demandés, dans l'ordre.
 * @param {string[]} files  ex. ['data.js', 'store.js', 'engine.js']
 * @returns le `window` du bac à sable
 */
function loadFront(files) {
  const noop = () => {};
  const win = {
    localStorage: memStorage(),
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async () => { throw new Error('réseau indisponible dans les tests'); },
    navigator: { sendBeacon: () => false },
    location: { protocol: 'http:', href: 'http://localhost/' },
    addEventListener: noop, removeEventListener: noop,
    document: {
      readyState: 'complete',
      addEventListener: noop, removeEventListener: noop,
      querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop })
    },
    Intl, Math, Date, JSON
  };
  win.window = win;
  win.globalThis = win;
  const ctx = vm.createContext(win);

  for (const f of files) {
    const src = fs.readFileSync(path.join(PUB, f), 'utf8');
    vm.runInContext(src, ctx, { filename: 'public/js/' + f });
  }
  return win;
}

module.exports = { loadFront, memStorage };
