/* ============================================================================
   store.js — État de l'application, persistance locale, calculs de portefeuille
   Aucune donnée ne quitte la machine : tout est dans localStorage.
   ========================================================================== */
(function (G) {
  'use strict';
  const KEY = 'investai.state.v1';

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  /* Dates en heure LOCALE.
     `toISOString()` bascule en UTC : à Paris (UTC+1/+2), le 1er août à 00 h 00
     locale devient « 2026-07-31T22:00Z ». Utilisé pour dater un mouvement ou
     construire une clé de mois, cela décale la date d'un jour en soirée et la
     clé de mois d'un mois entier. Tout ce qui est daté ici l'est donc en local. */
  const pad = n => String(n).padStart(2, '0');
  const localISO = (d) => {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  const localMonth = (d) => { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  const todayISO = () => localISO();
  const monthKey = (d) => (typeof d === 'string' && d) ? d.slice(0, 7)
    : (d instanceof Date) ? localMonth(d) : localMonth();

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
        target: Object.assign({}, G.DATA.PROFILES.equilibre.target)   // etf/actions/crypto/immobilier
      },
      holdings: [],      // ETF + actions
      bricks: [],        // immobilier participatif
      /* Les liquidités ne comptent plus dans le patrimoine (elles vivent sur un
         autre compte). Le tableau est conservé pour ne perdre aucune donnée
         déjà saisie, mais il n'est ni affiché ni valorisé. */
      cashAccounts: [],
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
        const parsed = migrateRaw(JSON.parse(raw));
        state = migrate(deepMerge(blankState(), parsed));
      }
    } catch (e) { console.warn('Lecture du stockage impossible', e); }
    return state;
  }
  /** Charge depuis le serveur (mode serveur uniquement). */
  async function loadRemote() {
    if (!(G.Api && G.Api.isServer)) return false;
    const remote = await G.Api.loadState();
    if (remote && typeof remote === 'object') {
      state = migrate(deepMerge(blankState(), migrateRaw(remote)));
      // les clés d'API n'existent pas côté client en mode serveur
      state.settings.keys = { twelvedata: '', finnhub: '', alphavantage: '', anthropic: '' };
      saveLocalCopy();
      return true;
    }
    return false;
  }
  /** Remplace l'état par celui fourni (après un rafraîchissement serveur). */
  function replaceState(obj) {
    state = migrate(deepMerge(blankState(), migrateRaw(obj)));
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
  const CLASSES = ['etf', 'actions', 'crypto', 'immobilier'];
  /** Ne garde que les quatre classes suivies, en nombres. */
  function normaliseTarget(t) {
    const out = {};
    CLASSES.forEach(k => out[k] = Number((t || {})[k]) || 0);
    return out;
  }

  /* Migration d'un état ENREGISTRÉ, appliquée sur l'objet brut AVANT la fusion
     avec blankState() : après la fusion, la cible par défaut aurait déjà rempli
     `crypto`, et l'ancien poids `cash` serait perdu en silence. */
  function migrateRaw(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    const t = raw.profile && typeof raw.profile === 'object' && raw.profile.target;
    if (t && typeof t === 'object' && t.cash != null && t.crypto == null) {
      // La poche liquidités disparaît du patrimoine : son poids cible devient
      // celui de la nouvelle poche crypto, pour que la somme reste à 100.
      t.crypto = Number(t.cash) || 0;
    }
    if (t && typeof t === 'object') delete t.cash;
    (Array.isArray(raw.holdings) ? raw.holdings : []).forEach(h => {
      // un type inconnu resterait invalorisable : on le ramène à 'etf'
      if (h && h.type !== 'etf' && h.type !== 'action' && h.type !== 'crypto') h.type = 'etf';
    });
    return raw;
  }
  /** Après fusion : la cible ne doit contenir que les classes suivies. */
  function migrate(st) {
    st.profile = st.profile || {};
    st.profile.target = normaliseTarget(st.profile.target);
    return st;
  }

  function deepMerge(base, over) {
    if (over === null || over === undefined) return base;
    // `typeof null` vaut 'object' : sans ce garde-fou, un champ valant null dans
    // l'état vierge (settings.lastRefresh, par exemple) faisait planter la fusion
    // dès que l'état enregistré y mettait une chaîne — donc à chaque rechargement
    // suivant un rafraîchissement des cours.
    if (base === null || base === undefined) return over;
    if (Array.isArray(base)) return Array.isArray(over) ? over : base;
    if (typeof base !== 'object' || typeof over !== 'object') return over;
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
      catalogId: null, sector: null, region: null, addedAt: todayISO(),
      // staking / rendement d'immobilisation (cryptos surtout)
      stakingPct: null, stakingFrom: null, stakingUntil: null
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

  /** Fiche d'un cryptoactif du catalogue, à partir de son ticker. */
  function cryptoMeta(ticker) {
    return G.DATA.CRYPTO_BY_TICKER[String(ticker || '').toUpperCase().split('/')[0]] || null;
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
    const cryptoValue = holdings.filter(h => h.type === 'crypto').reduce((s, h) => s + h._value, 0);
    const bricksValue = state.bricks
      .filter(b => b.status !== 'remboursé' && b.status !== 'perdu')
      .reduce((s, b) => s + (Number(b.amount) || 0), 0);

    /* Les liquidités ne font PAS partie du patrimoine suivi ici : elles vivent
       sur un autre compte. `profile.availableCash` reste seulement un paramètre
       de « Mon plan » — le capital que tu es prêt à déployer. */
    const invested = etfValue + stockValue + cryptoValue + bricksValue;
    const total = invested;

    /* Plus-value calculée UNIQUEMENT sur les lignes ayant un prix de revient.
       Une position importée depuis une capture d'écran n'en a souvent aucun :
       la compter à coût nul afficherait la totalité de sa valeur comme un gain.
       `plCoverage` dit quelle part du portefeuille la plus-value couvre. */
    const priced = holdings.filter(h => h._cost > 0);
    const costKnown = priced.reduce((s, h) => s + h._cost, 0);
    const valueKnown = priced.reduce((s, h) => s + h._value, 0);
    const marketValue = etfValue + stockValue + cryptoValue;
    const cost = holdings.reduce((s, h) => s + h._cost, 0) + bricksValue;
    const pl = valueKnown - costKnown;
    const plPct = costKnown > 0 ? (pl / costKnown) * 100 : 0;
    const plCoverage = marketValue > 0 ? (valueKnown / marketValue) * 100 : 100;
    const unpriced = holdings.filter(h => h._cost <= 0 && h._value > 0);

    const alloc = { etf: 0, actions: 0, crypto: 0, immobilier: 0 };
    if (total > 0) {
      alloc.etf = etfValue / total * 100;
      alloc.actions = stockValue / total * 100;
      alloc.crypto = cryptoValue / total * 100;
      alloc.immobilier = bricksValue / total * 100;
    }

    return {
      holdings, etfValue, stockValue, cryptoValue, bricksValue, invested, total, cost, pl, plPct,
      plCoverage, unpriced, alloc,
      target: normaliseTarget(state.profile.target),
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
      const mk = localMonth(d);
      out.push({ month: mk, amount: investedInMonth(mk) });
    }
    return out;
  }
  function incomeLast12m() {
    const cut = new Date(); cut.setFullYear(cut.getFullYear() - 1);
    const cutISO = localISO(cut);
    return state.transactions
      .filter(t => (t.kind === 'dividend' || t.kind === 'interest' || t.kind === 'rent') && t.date >= cutISO)
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  }
  /** Rendement courant estimé : revenus encaissés + coupons attendus immobilier. */
  function currentYield(snap) {
    const bricksIncome = state.bricks
      .filter(b => b.status !== 'remboursé' && b.status !== 'perdu')
      .reduce((s, b) => s + (Number(b.amount) || 0) * (Number(b.yieldPct) || 0) / 100, 0);
    /* Staking : rendement annoncé × valeur immobilisée. Comme pour l'immobilier,
       c'est une ESPÉRANCE annoncée par la plateforme, pas un revenu encaissé —
       les deux sont donc comptés séparément de `realised`. */
    const stakingIncome = snap.holdings
      .filter(h => Number(h.stakingPct) > 0)
      .reduce((s, h) => s + h._value * Number(h.stakingPct) / 100, 0);
    const realised = incomeLast12m();
    const base = snap.invested;
    return {
      realised, expectedRealEstate: bricksIncome, expectedStaking: stakingIncome,
      pct: base > 0 ? ((realised + bricksIncome + stakingIncome) / base) * 100 : 0
    };
  }
  /** Positions immobilisées dont la date de déblocage n'est pas passée. */
  function lockedHoldings() {
    const today = todayISO();
    return state.holdings.filter(h => h.stakingUntil && h.stakingUntil > today);
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
    state = migrate(deepMerge(blankState(), migrateRaw(parsed)));
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
    load, loadRemote, replaceState, save, uid, todayISO, monthKey, localISO, localMonth,
    addHolding, updateHolding, removeHolding,
    addBrick, updateBrick, removeBrick,
    addCash, updateCash, removeCash,
    addTransaction, removeTransaction,
    addJournal, updateJournal, removeJournal,
    addWatch, removeWatch,
    etfCatalog, findCatalog, cryptoMeta, normaliseTarget, CLASSES,
    priceOf, valueOf, costOf, snapshot,
    investedInMonth, monthlySeries, incomeLast12m, currentYield, lockedHoldings,
    exportJSON, importJSON, wipe, blankState
  };
})(window);
