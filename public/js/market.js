/* ============================================================================
   market.js — Fournisseurs de données de marché
   RÈGLE 13 : chaque donnée renvoyée porte sa source et sa date.
   Si aucun fournisseur ne répond, on renvoie null — jamais une valeur inventée.

   En mode SERVEUR, tout passe par /api/* : les clés restent sur le VPS, le
   cache est partagé entre tes appareils et aucun appel n'est fait au
   fournisseur depuis le navigateur. Le code direct ci-dessous ne sert plus
   qu'au mode LOCAL (fichier ouvert en file://).
   ========================================================================== */
(function (G) {
  'use strict';
  const viaServer = () => G.Api && G.Api.isServer;

  const TTL = { quote: 15 * 60e3, fundamentals: 24 * 3600e3, series: 12 * 3600e3, fx: 12 * 3600e3 };
  const keys = () => G.Store.state.settings.keys;
  const cache = () => G.Store.state.cache;

  /* ------------------------------------------------------- file d'attente */
  /* Les offres gratuites limitent le débit (Twelve Data : 8 appels/minute).
     On sérialise les requêtes avec un intervalle minimum par fournisseur.   */
  const queues = {};
  function throttled(provider, minGap, fn) {
    if (!queues[provider]) queues[provider] = { last: 0, chain: Promise.resolve() };
    const q = queues[provider];
    q.chain = q.chain.then(async () => {
      const wait = Math.max(0, minGap - (Date.now() - q.last));
      if (wait) await new Promise(r => setTimeout(r, wait));
      q.last = Date.now();
      return fn();
    }).catch(e => { throw e; });
    return q.chain;
  }

  async function getJSON(url, timeoutMs) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), timeoutMs || 12000);
    try {
      const r = await fetch(url, { signal: ctl.signal, mode: 'cors' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(to); }
  }

  const fresh = (entry, ttl) => entry && entry.ts && (Date.now() - entry.ts) < ttl;
  const num = v => { const n = Number(v); return isFinite(n) ? n : null; };

  /* ========================================================== TAUX DE CHANGE */
  /* Frankfurter : données BCE, gratuit, sans clé. */
  async function fx(from, to) {
    from = (from || 'EUR').toUpperCase(); to = (to || 'EUR').toUpperCase();
    if (from === to) return { rate: 1, source: '—', asOf: G.Store.todayISO() };
    if (viaServer()) {
      try { return await G.Api.fx(from, to); } catch (e) { return null; }
    }
    const k = from + to;
    if (fresh(cache().fx[k], TTL.fx)) return cache().fx[k].v;
    // api.frankfurter.dev est le domaine courant ; .app est conservé en secours
    const urls = [
      `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`,
      `https://api.frankfurter.app/latest?from=${from}&to=${to}`
    ];
    for (const url of urls) {
      try {
        const j = await throttled('frankfurter', 300, () => getJSON(url));
        const rate = num(j && j.rates && j.rates[to]);
        if (rate == null) continue;
        const v = { rate, source: 'Frankfurter (BCE)', asOf: j.date };
        cache().fx[k] = { ts: Date.now(), v }; G.Store.save();
        return v;
      } catch (e) { /* domaine suivant */ }
    }
    return null;
  }

  /* ================================================================ COTATION */
  async function quoteTwelve(symbol) {
    const key = keys().twelvedata; if (!key) return null;
    const j = await throttled('twelvedata', 8000, () =>
      getJSON(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${key}`));
    if (!j || j.status === 'error' || j.code) return null;
    const price = num(j.close ?? j.price);
    if (price == null) return null;
    return {
      price, currency: j.currency || null, changePct: num(j.percent_change),
      name: j.name || null, exchange: j.exchange || null,
      fiftyTwoHigh: num(j.fifty_two_week && j.fifty_two_week.high),
      fiftyTwoLow: num(j.fifty_two_week && j.fifty_two_week.low),
      source: 'Twelve Data', asOf: j.datetime || G.Store.todayISO()
    };
  }
  async function quoteFinnhub(symbol) {
    const key = keys().finnhub; if (!key) return null;
    const j = await throttled('finnhub', 1100, () =>
      getJSON(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`));
    const price = num(j && j.c);
    if (!price) return null;
    return {
      price, currency: null, changePct: num(j.dp), previousClose: num(j.pc),
      source: 'Finnhub', asOf: j.t ? new Date(j.t * 1000).toISOString().slice(0, 10) : G.Store.todayISO()
    };
  }
  async function quoteAlpha(symbol) {
    const key = keys().alphavantage; if (!key) return null;
    const j = await throttled('alphavantage', 13000, () =>
      getJSON(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${key}`));
    const q = j && j['Global Quote'];
    const price = num(q && q['05. price']);
    if (price == null) return null;
    return {
      price, changePct: num(String(q['10. change percent'] || '').replace('%', '')),
      source: 'Alpha Vantage', asOf: q['07. latest trading day'] || G.Store.todayISO()
    };
  }

  /** Cotation : essaie chaque fournisseur configuré, garde le premier succès. */
  async function quote(symbol, opts) {
    opts = opts || {};
    if (!symbol) return null;
    const k = symbol.toUpperCase();
    if (viaServer()) {
      try { return await G.Api.quote(k, opts); } catch (e) { return null; }
    }
    if (!opts.force && fresh(cache().quotes[k], TTL.quote)) return cache().quotes[k].v;
    for (const fn of [quoteTwelve, quoteFinnhub, quoteAlpha]) {
      try {
        const v = await fn(symbol);
        if (v) { cache().quotes[k] = { ts: Date.now(), v }; G.Store.save(); return v; }
      } catch (e) { /* fournisseur suivant */ }
    }
    return null;
  }

  /* ======================================================= SÉRIE HISTORIQUE */
  /** Clôtures quotidiennes → volatilité, performance, drawdown réels. */
  async function series(symbol, opts) {
    opts = opts || {};
    if (!symbol) return null;
    const k = symbol.toUpperCase();
    if (viaServer()) {
      try {
        const v = await G.Api.series(k, opts);
        // le serveur renvoie déjà les statistiques calculées
        if (v) cache().series[k] = { ts: Date.now(), v };
        return v;
      } catch (e) { return null; }
    }
    if (!opts.force && fresh(cache().series[k], TTL.series)) return cache().series[k].v;

    const key = keys().twelvedata;
    let closes = null, src = null, asOf = null;

    if (key) {
      try {
        const j = await throttled('twelvedata', 8000, () =>
          getJSON(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}` +
                  `&interval=1day&outputsize=1300&apikey=${key}`, 20000));
        if (j && Array.isArray(j.values) && j.values.length > 30) {
          closes = j.values.map(v => ({ d: v.datetime, c: num(v.close) }))
                           .filter(v => v.c != null).reverse();          // ancien → récent
          src = 'Twelve Data'; asOf = closes[closes.length - 1].d;
        }
      } catch (e) { /* secours */ }
    }
    if (!closes && keys().alphavantage) {
      try {
        const j = await throttled('alphavantage', 13000, () =>
          getJSON(`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}` +
                  `&outputsize=full&apikey=${keys().alphavantage}`, 25000));
        const ts = j && j['Time Series (Daily)'];
        if (ts) {
          closes = Object.keys(ts).sort().map(d => ({ d, c: num(ts[d]['4. close']) })).filter(v => v.c != null);
          src = 'Alpha Vantage'; asOf = closes.length ? closes[closes.length - 1].d : null;
        }
      } catch (e) { /* rien */ }
    }
    if (!closes || closes.length < 30) return null;

    const v = Object.assign({ closes, source: src, asOf }, computeStats(closes));
    cache().series[k] = { ts: Date.now(), v }; G.Store.save();
    return v;
  }

  /** Statistiques calculées sur les clôtures réelles (pas d'estimation). */
  function computeStats(closes) {
    const c = closes.map(x => x.c);
    const n = c.length;
    const rets = [];
    for (let i = 1; i < n; i++) if (c[i - 1] > 0) rets.push(c[i] / c[i - 1] - 1);

    const mean = rets.reduce((s, r) => s + r, 0) / (rets.length || 1);
    const varc = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1 || 1);
    const volAnn = Math.sqrt(varc) * Math.sqrt(252) * 100;

    // drawdown maximum
    let peak = c[0], maxDD = 0;
    for (const x of c) { if (x > peak) peak = x; const dd = (x / peak - 1) * 100; if (dd < maxDD) maxDD = dd; }

    const perfOver = (days) => {
      if (n <= days) return null;
      const past = c[n - 1 - days];
      return past > 0 ? (c[n - 1] / past - 1) * 100 : null;
    };
    const years = (n - 1) / 252;
    const cagr = (years >= 0.9 && c[0] > 0) ? ((c[n - 1] / c[0]) ** (1 / years) - 1) * 100 : null;

    // rendement/risque : excédent sur un taux sans risque prudent de 2 %
    const sharpe = (cagr != null && volAnn > 0) ? (cagr - 2) / volAnn : null;

    return {
      volAnn, maxDD, cagr, sharpe, years,
      perf1m: perfOver(21), perf6m: perfOver(126), perf1y: perfOver(252),
      perf3y: perfOver(756), perf5y: perfOver(1260),
      last: c[n - 1], first: c[0], points: n
    };
  }

  /* ========================================================== FONDAMENTAUX */
  async function fundamentalsFinnhub(symbol) {
    const key = keys().finnhub; if (!key) return null;
    let metric = null, profile = null;
    try {
      const j = await throttled('finnhub', 1100, () =>
        getJSON(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${key}`));
      metric = j && j.metric;
    } catch (e) { /* premium ou indisponible */ }
    try {
      const p = await throttled('finnhub', 1100, () =>
        getJSON(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${key}`));
      if (p && p.name) profile = p;
    } catch (e) { /* rien */ }
    if (!metric && !profile) return null;
    const m = metric || {};
    return clean({
      name: profile && profile.name, sector: profile && profile.finnhubIndustry,
      country: profile && profile.country, currency: profile && profile.currency,
      marketCap: profile && num(profile.marketCapitalization),
      pe: num(m.peTTM ?? m.peBasicExclExtraTTM ?? m.peNormalizedAnnual),
      pb: num(m.pbQuarterly ?? m.pbAnnual),
      ps: num(m.psTTM),
      evEbitda: num(m['currentEv/freeCashFlowTTM'] ?? m.evEbitdaTTM),
      dividendYield: num(m.currentDividendYieldTTM ?? m.dividendYieldIndicatedAnnual),
      payout: num(m.payoutRatioTTM),
      netMargin: num(m.netProfitMarginTTM ?? m.netProfitMarginAnnual),
      operMargin: num(m.operatingMarginTTM ?? m.operatingMarginAnnual),
      grossMargin: num(m.grossMarginTTM ?? m.grossMarginAnnual),
      roe: num(m.roeTTM ?? m.roeRfy),
      roa: num(m.roaTTM ?? m.roaRfy),
      roic: num(m.roiTTM ?? m.roiAnnual),
      debtToEquity: num(m['totalDebt/totalEquityQuarterly'] ?? m['totalDebt/totalEquityAnnual']),
      currentRatio: num(m.currentRatioQuarterly ?? m.currentRatioAnnual),
      revenueGrowth: num(m.revenueGrowthTTMYoy ?? m.revenueGrowthQuarterlyYoy ?? m.revenueGrowth5Y),
      revenueGrowth5Y: num(m.revenueGrowth5Y),
      epsGrowth: num(m.epsGrowthTTMYoy ?? m.epsGrowthQuarterlyYoy),
      epsGrowth5Y: num(m.epsGrowth5Y),
      beta: num(m.beta),
      high52: num(m['52WeekHigh']), low52: num(m['52WeekLow']),
      _source: 'Finnhub', _asOf: G.Store.todayISO()
    });
  }

  async function fundamentalsAlpha(symbol) {
    const key = keys().alphavantage; if (!key) return null;
    const j = await throttled('alphavantage', 13000, () =>
      getJSON(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(symbol)}&apikey=${key}`));
    if (!j || !j.Symbol) return null;
    const pct = v => { const n = num(v); return n == null ? null : n * 100; };
    return clean({
      name: j.Name, sector: j.Sector, country: j.Country, currency: j.Currency,
      marketCap: num(j.MarketCapitalization) ? num(j.MarketCapitalization) / 1e6 : null,
      pe: num(j.PERatio), peg: num(j.PEGRatio), pb: num(j.PriceToBookRatio), ps: num(j.PriceToSalesRatioTTM),
      evEbitda: num(j.EVToEBITDA),
      dividendYield: pct(j.DividendYield), eps: num(j.EPS),
      netMargin: pct(j.ProfitMargin), operMargin: pct(j.OperatingMarginTTM),
      roe: pct(j.ReturnOnEquityTTM), roa: pct(j.ReturnOnAssetsTTM),
      revenueGrowth: pct(j.QuarterlyRevenueGrowthYOY),
      epsGrowth: pct(j.QuarterlyEarningsGrowthYOY),
      beta: num(j.Beta), high52: num(j['52WeekHigh']), low52: num(j['52WeekLow']),
      bookValue: num(j.BookValue), revenueTTM: num(j.RevenueTTM),
      analystTarget: num(j.AnalystTargetPrice),
      _source: 'Alpha Vantage', _asOf: j.LatestQuarter || G.Store.todayISO()
    });
  }

  function clean(o) {
    const out = {};
    Object.keys(o).forEach(k => { if (o[k] !== null && o[k] !== undefined && o[k] !== '' && o[k] !== 'None') out[k] = o[k]; });
    return out;
  }

  /** Fusionne les fournisseurs ; conserve la trace de l'origine de chaque bloc. */
  async function fundamentals(symbol, opts) {
    opts = opts || {};
    if (!symbol) return null;
    const k = symbol.toUpperCase();
    if (viaServer()) {
      try { return await G.Api.fundamentals(k, opts); } catch (e) { return null; }
    }
    if (!opts.force && fresh(cache().fundamentals[k], TTL.fundamentals)) return cache().fundamentals[k].v;

    const sources = [];
    let merged = {};
    for (const fn of [fundamentalsFinnhub, fundamentalsAlpha]) {
      try {
        const v = await fn(symbol);
        if (v) {
          sources.push({ name: v._source, asOf: v._asOf });
          Object.keys(v).forEach(key => {
            if (key.startsWith('_')) return;
            if (merged[key] === undefined) merged[key] = v[key];   // premier fournisseur prioritaire
          });
        }
      } catch (e) { /* suivant */ }
    }
    if (!sources.length) return null;
    merged._sources = sources;
    merged._asOf = sources[0].asOf;
    merged._source = sources.map(s => s.name).join(' + ');
    // PEG reconstitué si absent mais calculable — marqué comme dérivé
    if (merged.peg == null && merged.pe != null && merged.epsGrowth > 0) {
      merged.peg = merged.pe / merged.epsGrowth;
      merged._pegDerived = true;
    }
    cache().fundamentals[k] = { ts: Date.now(), v: merged }; G.Store.save();
    return merged;
  }

  /* ============================================ rafraîchissement portefeuille */
  async function refreshHoldings(onProgress) {
    const st = G.Store.state;
    // En mode serveur, c'est le backend qui rafraîchit et enregistre : il a le
    // cache partagé et les clés. On recharge ensuite l'état qu'il a produit.
    if (viaServer()) {
      const r = await G.Api.refreshAll();
      if (r && r.skipped) return { total: 0, updated: 0, skipped: r.reason };
      const fresh = await G.Api.loadState();
      if (fresh) G.Store.replaceState(fresh);
      return { total: (r && r.total) || 0, updated: (r && r.updated) || 0 };
    }
    const list = st.holdings.filter(h => h.ticker);
    let done = 0, ok = 0;
    for (const h of list) {
      const q = await quote(h.ticker, { force: true });
      let written = false;
      if (q) {
        const conv = await toHoldingCurrency(q, h);
        // règle 1 : aucune donnée inventée. Si le change est indisponible, on
        // garde l'ancien prix plutôt que d'inscrire un montant en devise
        // étrangère comme s'il était en euros.
        if (conv) {
          G.Store.updateHolding(h.id, {
            lastPrice: conv.price, lastPriceDate: q.asOf, lastPriceSource: conv.source
          });
          written = true; ok++;
        }
      }
      done++;
      if (onProgress) onProgress(done, list.length, h.ticker, written);
    }
    st.settings.lastRefresh = new Date().toISOString();
    G.Store.save();
    return { total: list.length, updated: ok };
  }

  /** Ramène une cotation dans la devise de la ligne.
   *  Renvoie null si la conversion est nécessaire mais impossible : mieux vaut
   *  ne pas mettre à jour que valoriser un titre dans la mauvaise devise.
   *  Si le fournisseur ne dit pas dans quelle devise il cote (cas de Finnhub),
   *  on inscrit le prix mais on le signale, pour que la confiance baisse.   */
  async function toHoldingCurrency(q, h) {
    const hc = String(h.currency || 'EUR').toUpperCase();
    if (!q.currency) {
      return { price: q.price, source: q.source + ' · devise non confirmée' };
    }
    const qc = String(q.currency).toUpperCase();
    if (qc === hc) return { price: q.price, source: q.source };
    const r = await fx(qc, hc);
    if (!r) return null;
    return { price: q.price * r.rate, source: q.source + ' + change BCE (' + qc + '→' + hc + ')' };
  }

  /** Y a-t-il au moins un fournisseur de prix configuré ? */
  function hasProvider() {
    if (viaServer()) return !!(G.Api.config && G.Api.config.hasMarketData);
    const k = keys();
    return !!(k.twelvedata || k.finnhub || k.alphavantage);
  }
  function providerStatus() {
    if (viaServer() && G.Api.config && G.Api.config.providers) return G.Api.config.providers;
    const k = keys();
    return [
      { name: 'Twelve Data', on: !!k.twelvedata, role: 'prix + historiques' },
      { name: 'Finnhub', on: !!k.finnhub, role: 'fondamentaux actions' },
      { name: 'Alpha Vantage', on: !!k.alphavantage, role: 'secours' },
      { name: 'Frankfurter (BCE)', on: true, role: 'change' }
    ];
  }

  async function testKeys() {
    const out = [];
    if (keys().twelvedata) {
      try { const q = await quoteTwelve('AAPL'); out.push({ n: 'Twelve Data', ok: !!q, d: q ? q.price + ' ' + (q.currency || '') : 'aucune réponse exploitable' }); }
      catch (e) { out.push({ n: 'Twelve Data', ok: false, d: e.message }); }
    }
    if (keys().finnhub) {
      try { const q = await quoteFinnhub('AAPL'); out.push({ n: 'Finnhub', ok: !!q, d: q ? String(q.price) : 'aucune réponse exploitable' }); }
      catch (e) { out.push({ n: 'Finnhub', ok: false, d: e.message }); }
    }
    if (keys().alphavantage) {
      try { const q = await quoteAlpha('AAPL'); out.push({ n: 'Alpha Vantage', ok: !!q, d: q ? String(q.price) : 'quota atteint ou réponse vide' }); }
      catch (e) { out.push({ n: 'Alpha Vantage', ok: false, d: e.message }); }
    }
    try { const r = await fx('USD', 'EUR'); out.push({ n: 'Frankfurter (BCE)', ok: !!r, d: r ? '1 USD = ' + r.rate.toFixed(4) + ' EUR' : 'indisponible' }); }
    catch (e) { out.push({ n: 'Frankfurter (BCE)', ok: false, d: e.message }); }
    return out;
  }

  G.Market = {
    quote, series, fundamentals, fx, refreshHoldings,
    hasProvider, providerStatus, testKeys, computeStats
  };
})(window);
