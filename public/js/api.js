/* ============================================================================
   api.js — Liaison avec le serveur.
   L'application fonctionne dans deux modes, détectés automatiquement :

   · SERVEUR  — servie par le backend (VPS/Dokploy). Les clés d'API restent sur
     le serveur, le portefeuille y est stocké et donc synchronisé entre tous
     tes appareils, et les cours se rafraîchissent tout seuls.
   · LOCAL    — fichier ouvert directement (file://). Stockage dans le
     navigateur ; les données de marché exigent alors des clés saisies à la main.
   ========================================================================== */
(function (G) {
  'use strict';

  const state = {
    mode: 'inconnu',        // 'serveur' | 'local'
    authed: false,
    needsPassword: false,
    config: null
  };

  const isFileProtocol = () => location.protocol === 'file:';

  async function req(path, opts) {
    opts = opts || {};
    const r = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin'
    });
    let data = null;
    try { data = await r.json(); } catch (e) { /* corps vide */ }
    if (!r.ok) {
      const err = new Error((data && data.error) || ('HTTP ' + r.status));
      err.status = r.status;
      throw err;
    }
    return data;
  }

  /** Détecte le mode au démarrage. Ne lève jamais : en cas de doute → local. */
  async function detect() {
    if (isFileProtocol()) {
      state.mode = 'local';
      state.authed = true;
      return state;
    }
    try {
      const cfg = await req('/api/config');
      state.mode = 'serveur';
      state.config = cfg;
      state.authed = !!cfg.authed;
      state.needsPassword = !!cfg.needsPassword;
    } catch (e) {
      state.mode = 'local';
      state.authed = true;
    }
    return state;
  }

  async function login(password) {
    await req('/api/login', { method: 'POST', body: { password } });
    const cfg = await req('/api/config');
    state.config = cfg; state.authed = !!cfg.authed;
    return state;
  }
  async function logout() {
    try { await req('/api/logout', { method: 'POST' }); } catch (e) { /* rien */ }
    state.authed = false;
  }
  async function refreshConfig() {
    if (state.mode !== 'serveur') return state.config;
    try { state.config = await req('/api/config'); state.authed = !!state.config.authed; }
    catch (e) { /* on garde la config précédente */ }
    return state.config;
  }

  /* ------------------------------------------------------------ portefeuille */
  async function loadState() {
    if (state.mode !== 'serveur') return null;
    try { return await req('/api/state'); }
    catch (e) { console.warn('état serveur illisible', e.message); return null; }
  }

  /* Enregistrement différé : on n'envoie pas une requête à chaque frappe.
     Le dernier état gagne ; un seul envoi est en vol à la fois.            */
  let saveTimer = null, savePending = null, saveInFlight = false;
  let onSaveStatus = null;

  function saveState(obj, immediate) {
    if (state.mode !== 'serveur') return Promise.resolve();
    savePending = obj;
    if (saveTimer) clearTimeout(saveTimer);
    if (immediate) return flush();
    saveTimer = setTimeout(flush, 900);
    return Promise.resolve();
  }
  async function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (saveInFlight || savePending === null) return;
    const body = savePending; savePending = null; saveInFlight = true;
    if (onSaveStatus) onSaveStatus('enregistrement');
    try {
      await req('/api/state', { method: 'PUT', body });
      if (onSaveStatus) onSaveStatus('enregistré');
    } catch (e) {
      if (onSaveStatus) onSaveStatus('échec : ' + e.message);
      console.warn('enregistrement impossible', e.message);
    } finally {
      saveInFlight = false;
      if (savePending !== null) flush();          // un état plus récent est arrivé
    }
  }
  /** Dernière chance d'enregistrer quand l'onglet se ferme. */
  function flushBeacon() {
    if (state.mode !== 'serveur' || savePending === null) return;
    try {
      navigator.sendBeacon('/api/state',
        new Blob([JSON.stringify(savePending)], { type: 'application/json' }));
      savePending = null;
    } catch (e) { /* rien */ }
  }

  /* --------------------------------------------------------- données marché */
  async function quote(symbol, opts) {
    const r = await req('/api/quote?symbol=' + encodeURIComponent(symbol) + ((opts && opts.force) ? '&force=1' : ''));
    return r && r.data;
  }
  async function series(symbol, opts) {
    const r = await req('/api/series?symbol=' + encodeURIComponent(symbol) + ((opts && opts.force) ? '&force=1' : ''));
    return r && r.data;
  }
  async function fundamentals(symbol, opts) {
    const r = await req('/api/fundamentals?symbol=' + encodeURIComponent(symbol) + ((opts && opts.force) ? '&force=1' : ''));
    return r && r.data;
  }
  async function fx(from, to) {
    const r = await req('/api/fx?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to));
    return r && r.data;
  }
  async function refreshAll() { return await req('/api/refresh', { method: 'POST' }); }
  async function chat(system, messages) {
    const r = await req('/api/chat', { method: 'POST', body: { system, messages } });
    return r && r.text;
  }

  G.Api = {
    get mode() { return state.mode; },
    get authed() { return state.authed; },
    get needsPassword() { return state.needsPassword; },
    get config() { return state.config; },
    get isServer() { return state.mode === 'serveur'; },
    set onSaveStatus(fn) { onSaveStatus = fn; },
    detect, login, logout, refreshConfig,
    loadState, saveState, flush, flushBeacon,
    quote, series, fundamentals, fx, refreshAll, chat
  };

  window.addEventListener('beforeunload', flushBeacon);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
})(window);
