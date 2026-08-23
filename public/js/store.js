/* ============================================================================
   store.js — État de l'application, persistance locale, calculs de portefeuille
   Aucune donnée ne quitte la machine : tout est dans localStorage.
   ========================================================================== */
(function (G) {
  'use strict';
  const KEY = 'investai.state.v1';

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const monthKey = (d) => (d || todayISO()).slice(0, 7);

  function blankState() {
    return {
      version: 1,
      createdAt: todayISO(),
      profile: {
        riskProfile: 'equilibre',
        primaryProfile: 'equilibre',      // règle 3 : l'équilibré reste la référence
        horizonYears: 10,
        monthlyBudget: 150,
        availableCash: 0,
        target: Object.assign({}, G.DATA.PROFILES.equilibre.target)
      },
      holdings: [],      // ETF + actions
      bricks: [],        // immobilier participatif
      cashAccounts: [],  // livrets, compte espèces
      transactions: [],  // achats/ventes/dividendes/versements
      journal: [],       // journal des décisions
      watchlist: [],     // tickers suivis
      etfExtra: [],      // ETF ajoutés à la main au catalogue
      settings: {
        keys: { twelvedata: '', finnhub: '', alphavantage: '', anthropic: '' },
        currency: 'EUR',
        lastRefresh: null
      },
      cache: { quotes: {}, fundamentals: {}, series: {}, fx: {} },
      chat: []
    };
  }

  let state = blankState();

  /* ------------------------------------------------------------ persistance
     Mode SERVEUR : le portefeuille vit sur le VPS (synchronisé entre appareils),
     avec une copie locale de secours si le réseau tombe.
     Mode LOCAL   : uniquement le stockage du navigateur.                     */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = deepMerge(blankState(), parsed);
      }
    } catch (e) { console.warn('Lecture du stockage impossible', e); }
    return state;
  }
  /** Charge depuis le serveur (mode serveur uniquement). */
  async function loadRemote() {
    if (!(G.Api && G.Api.isServer)) return false;
    const remote = await G.Api.loadState();
    if (remote && typeof remote === 'object') {
      state = deepMerge(blankState(), remote);
      // les clés d'API n'existent pas côté client en mode serveur
      state.settings.keys = { twelvedata: '', finnhub: '', alphavantage: '', anthropic: '' };
      saveLocalCopy();
      return true;
    }
    return false;
  }
  /** Remplace l'état par celui fourni (après un rafraîchissement serveur). */
  function replaceState(obj) {
    state = deepMerge(blankState(), obj);
    saveLocalCopy();
    return state;
  }
  function saveLocalCopy() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { /* quota : sans gravité, le serveur fait foi */ }
  }
  function save(immediate) {
    saveLocalCopy();
    if (G.Api && G.Api.isServer) {
      // le cache marché est volumineux et reconstructible : il reste local
      const payload = Object.assign({}, state, { cache: { quotes: {}, fundamentals: {}, series: {}, fx: {} } });
      G.Api.saveState(payload, !!immediate);
    }
  }
  function deepMerge(base, over) {
    if (over === null || over === undefined) return base;
    if (Array.isArray(base)) return Array.isArray(over) ? over : base;
    if (typeof base !== 'object') return over;
    const out = Object.assign({}, base);
    Object.keys(over).forEach(k => {
      out[k] = (k in base) ? deepMerge(base[k], over[k]) : over[k];
    });
    return out;
  }

  /* -------------------------------------------------------------- mutations */
  function addHolding(h) {
    const rec = Object.assign({
      id: uid(), type: 'etf', ticker: '', name: '', isin: '', quantity: 0, avgPrice: 0,
      currency: 'EUR', account: 'CTO', lastPrice: null, lastPriceDate: null, lastPriceSource: null,
      catalogId: null, sector: null, region: null, addedAt: todayISO()
    }, h);
    state.holdings.push(rec);
    save(); return rec;
  }
  function updateHolding(id, patch) {
    const h = state.holdings.find(x => x.id === id);
    if (h) { Object.assign(h, patch); save(); }
    return h;
  }
  function removeHolding(id) {
    state.holdings = state.holdings.filter(x => x.id !== id);
    state.transactions = state.transactions.filter(t => t.holdingId !== id);
    save();
  }
  function addBrick(b) {
    const rec = Object.assign({
      id: uid(), platform: 'Bricks', name: '', amount: 0, yieldPct: 0, durationMonths: 12,
      location: '', projectType: '', promoter: '', guarantees: '', status: 'en cours',
      startDate: todayISO(), promoterTrack: null, ltv: null, delayed: false, notes: ''
    }, b);
    state.bricks.push(rec); save(); return rec;
  }
  function updateBrick(id, patch) { const b = state.bricks.find(x => x.id === id); if (b) { Object.assign(b, patch); save(); } return b; }
  function removeBrick(id) { state.bricks = state.bricks.filter(x => x.id !== id); save(); }

  function addCash(c) {
    const rec = Object.assign({ id: uid(), label: 'Compte', amount: 0, rate: 0 }, c);
    state.cashAccounts.push(rec); save(); return rec;
  }
  function updateCash(id, patch) { const c = state.cashAccounts.find(x => x.id === id); if (c) { Object.assign(c, patch); save(); } return c; }
  function removeCash(id) { state.cashAccounts = state.cashAccounts.filter(x => x.id !== id); save(); }

  function addTransaction(t) {
    const rec = Object.assign({
      id: uid(), date: todayISO(), kind: 'buy', holdingId: null, ticker: '', label: '',
      quantity: 0, price: 0, amount: 0, fees: 0, note: ''
    }, t);
    if (!rec.amount && rec.quantity && rec.price) rec.amount = rec.quantity * rec.price;
    state.transactions.push(rec);
    state.transactions.sort((a, b) => b.date.localeCompare(a.date));
    save(); return rec;
  }
  function removeTransaction(id) { state.transactions = state.transactions.filter(x => x.id !== id); save(); }

  function addJournal(entry) {
    const rec = Object.assign({
      id: uid(), date: new Date().toISOString(), asset: '', assetType: '', priceAtAnalysis: null,
      currency: 'EUR', reason: '', score: null, risks: '', recommendation: '', confidence: null,
      decision: 'en attente', reviewedAt: null, reviewNote: '', priceAtReview: null
    }, entry);
    state.journal.unshift(rec); save(); return rec;
  }
  function updateJournal(id, patch) { const j = state.journal.find(x => x.id === id); if (j) { Object.assign(j, patch); save(); } return j; }
  function removeJournal(id) { state.journal = state.journal.filter(x => x.id !== id); save(); }

  function addWatch(w) {
    if (state.watchlist.some(x => x.ticker.toUpperCase() === String(w.ticker).toUpperCase())) return null;
    const rec = Object.assign({ id: uid(), ticker: '', name: '', kind: 'action' }, w);
    state.watchlist.push(rec); save(); return rec;
  }
  function removeWatch(id) { state.watchlist = state.watchlist.filter(x => x.id !== id); save(); }

  /* ------------------------------------------------------------- catalogue */
  function etfCatalog() { return G.DATA.ETF_CATALOG.concat(state.etfExtra || []); }
  function findCatalog(idOrTicker) {
    const q = String(idOrTicker || '').toUpperCase();
    return etfCatalog().find(e =>
      e.id.toUpperCase() === q || (e.ticker || '').toUpperCase() === q || (e.isin || '').toUpperCase() === q);
  }

  /* --------------------------------------------------- valorisation positions */
  /** Prix retenu pour une ligne : dernier prix de marché si disponible,
   *  sinon prix de revient (et on le signale — jamais de prix inventé). */
  function priceOf(h) {
    if (h.lastPrice != null && isFinite(h.lastPrice) && h.lastPrice > 0) {
      return { price: h.lastPrice, live: true, date: h.lastPriceDate, source: h.lastPriceSource };
    }
    return { price: Number(h.avgPrice) || 0, live: false, date: null, source: 'prix de revient (aucune donnée de marché)' };
  }
  function valueOf(h) { return (Number(h.quantity) || 0) * priceOf(h).price; }
  function costOf(h) { return (Number(h.quantity) || 0) * (Number(h.avgPrice) || 0); }

  /* --------------------------------------------------------- vue consolidée */
  function snapshot() {
    const holdings = state.holdings.map(h => {
      const p = priceOf(h);
      const value = (Number(h.quantity) || 0) * p.price;
      const cost = costOf(h);
      const pl = value - cost;
      return Object.assign({}, h, {
        _price: p.price, _live: p.live, _priceDate: p.date, _priceSource: p.source,
        _value: value, _cost: cost, _pl: pl, _plPct: cost > 0 ? (pl / cost) * 100 : 0
      });
    });

    const etfValue = holdings.filter(h => h.type === 'etf').reduce((s, h) => s + h._value, 0);
    const stockValue = holdings.filter(h => h.type === 'action').reduce((s, h) => s + h._value, 0);
    const bricksValue = state.bricks
      .filter(b => b.status !== 'remboursé' && b.status !== 'perdu')
      .reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const cashValue = state.cashAccounts.reduce((s, c) => s + (Number(c.amount) || 0), 0)
      + (Number(state.profile.availableCash) || 0);

    const invested = etfValue + stockValue + bricksValue;
    const total = invested + cashValue;

    const cost = holdings.reduce((s, h) => s + h._cost, 0) + bricksValue;
    const pl = (etfValue + stockValue) - holdings.reduce((s, h) => s + h._cost, 0);
    const plPct = holdings.reduce((s, h) => s + h._cost, 0) > 0
      ? (pl / holdings.reduce((s, h) => s + h._cost, 0)) * 100 : 0;

    const alloc = { etf: 0, actions: 0, immobilier: 0, cash: 0 };
    if (total > 0) {
      alloc.etf = etfValue / total * 100;
      alloc.actions = stockValue / total * 100;
      alloc.immobilier = bricksValue / total * 100;
      alloc.cash = cashValue / total * 100;
    }

    return {
      holdings, etfValue, stockValue, bricksValue, cashValue, invested, total, cost, pl, plPct, alloc,
      target: state.profile.target,
      profile: G.DATA.PROFILES[state.profile.riskProfile] || G.DATA.PROFILES.equilibre
    };
  }

  /* ------------------------------------------------- flux : versements, revenus */
  function investedInMonth(mk) {
    mk = mk || monthKey();
    return state.transactions
      .filter(t => t.kind === 'buy' && monthKey(t.date) === mk)
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  }
  function monthlySeries(months) {
    months = months || 12;
    const out = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mk = d.toISOString().slice(0, 7);
      out.push({ month: mk, amount: investedInMonth(mk) });
    }
    return out;
  }
  function incomeLast12m() {
    const cut = new Date(); cut.setFullYear(cut.getFullYear() - 1);
    const cutISO = cut.toISOString().slice(0, 10);
    return state.transactions
      .filter(t => (t.kind === 'dividend' || t.kind === 'interest' || t.kind === 'rent') && t.date >= cutISO)
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  }
  /** Rendement courant estimé : revenus encaissés + coupons attendus immobilier. */
  function currentYield(snap) {
    const bricksIncome = state.bricks
      .filter(b => b.status !== 'remboursé' && b.status !== 'perdu')
      .reduce((s, b) => s + (Number(b.amount) || 0) * (Number(b.yieldPct) || 0) / 100, 0);
    const realised = incomeLast12m();
    const base = snap.invested;
    return {
      realised, expectedRealEstate: bricksIncome,
      pct: base > 0 ? ((realised + bricksIncome) / base) * 100 : 0
    };
  }

  /* ---------------------------------------------------------- import/export */
  function exportJSON() {
    const clone = JSON.parse(JSON.stringify(state));
    clone.settings.keys = { twelvedata: '', finnhub: '', alphavantage: '', anthropic: '' }; // jamais de clé exportée
    clone._exportedAt = new Date().toISOString();
    return JSON.stringify(clone, null, 2);
  }
  function importJSON(txt) {
    const parsed = JSON.parse(txt);
    const keys = state.settings.keys;                 // on garde les clés locales
    state = deepMerge(blankState(), parsed);
    state.settings.keys = keys;
    save();
  }
  function wipe() {
    try { localStorage.removeItem(KEY); } catch (e) { /* rien */ }
    state = blankState();
    save(true);                 // efface aussi côté serveur, immédiatement
  }

  G.Store = {
    get state() { return state; },
    load, loadRemote, replaceState, save, uid, todayISO, monthKey,
    addHolding, updateHolding, removeHolding,
    addBrick, updateBrick, removeBrick,
    addCash, updateCash, removeCash,
    addTransaction, removeTransaction,
    addJournal, updateJournal, removeJournal,
    addWatch, removeWatch,
    etfCatalog, findCatalog,
    priceOf, valueOf, costOf, snapshot,
    investedInMonth, monthlySeries, incomeLast12m, currentYield,
    exportJSON, importJSON, wipe, blankState
  };
})(window);
