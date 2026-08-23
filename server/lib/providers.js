/* ============================================================================
   providers.js — Accès aux fournisseurs de données de marché, CÔTÉ SERVEUR.
   Les clés d'API ne quittent jamais le serveur : le navigateur n'appelle que
   /api/*. Cela supprime aussi tout problème de CORS et permet un cache partagé.
   ========================================================================== */
'use strict';
const U = require('./util');

const TTL = {
  quote: 15 * 60e3,          // cotation : 15 min
  series: 12 * 3600e3,       // historique : 12 h
  fundamentals: 24 * 3600e3, // fondamentaux : 24 h
  fx: 12 * 3600e3
};
const STALE_MAX = 7 * 24 * 3600e3;   // au-delà, on ne sert plus le cache périmé

class Providers {
  constructor(env, cache, log) {
    this.keys = {
      twelvedata: (env.TWELVEDATA_KEY || '').trim(),
      finnhub: (env.FINNHUB_KEY || '').trim(),
      alphavantage: (env.ALPHAVANTAGE_KEY || '').trim()
    };
    this.cache = cache;
    this.log = log || (() => {});
    this.throttle = U.makeThrottle();
    this.stats = { calls: 0, errors: 0, cacheHits: 0, lastError: null };
  }

  status() {
    return [
      { name: 'Twelve Data', on: !!this.keys.twelvedata, role: 'cours et historiques' },
      { name: 'Finnhub', on: !!this.keys.finnhub, role: 'fondamentaux des actions' },
      { name: 'Alpha Vantage', on: !!this.keys.alphavantage, role: 'secours' },
      { name: 'Frankfurter (BCE)', on: true, role: 'taux de change' }
    ];
  }
  hasAny() { return !!(this.keys.twelvedata || this.keys.finnhub || this.keys.alphavantage); }

  async getJSON(url, timeoutMs) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || 15000);
    this.stats.calls++;
    try {
      const r = await fetch(url, {
        signal: ctl.signal,
        headers: { 'accept': 'application/json', 'user-agent': 'MonInvestisseurIA/1.0' }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      this.stats.errors++;
      this.stats.lastError = { at: new Date().toISOString(), msg: String(e.message).slice(0, 200) };
      throw e;
    } finally { clearTimeout(t); }
  }

  /** Cache d'abord ; en cas d'échec des fournisseurs, on sert la valeur périmée
   *  plutôt que rien — mais on l'indique explicitement (champ `stale`).      */
  async cached(key, ttl, producer) {
    const hit = this.cache.get(key, ttl);
    if (hit) { this.stats.cacheHits++; return hit; }
    try {
      const v = await producer();
      if (v) return this.cache.set(key, v);
      const s = this.cache.getStale(key);
      if (s && (Date.now() - s.ts) < STALE_MAX) return Object.assign({}, s.value, { stale: true });
      return null;
    } catch (e) {
      const s = this.cache.getStale(key);
      if (s && (Date.now() - s.ts) < STALE_MAX) {
        this.log('cache périmé servi pour ' + key + ' (' + e.message + ')');
        return Object.assign({}, s.value, { stale: true });
      }
      return null;
    }
  }

  /* ============================================================= COTATION */
  async quote(symbol, opts) {
    opts = opts || {};
    const key = 'q:' + symbol;
    if (opts.force) this.cache.delete(key);
    return this.cached(key, TTL.quote, async () => {
      for (const fn of ['_quoteTwelve', '_quoteFinnhub', '_quoteAlpha']) {
        try { const v = await this[fn](symbol); if (v) return v; }
        catch (e) { /* fournisseur suivant */ }
      }
      return null;
    });
  }
  async _quoteTwelve(symbol) {
    if (!this.keys.twelvedata) return null;
    const j = await this.throttle('td', 8000, () => this.getJSON(
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${this.keys.twelvedata}`));
    if (!j || j.status === 'error' || j.code) return null;
    const price = U.num(j.close != null ? j.close : j.price);
    if (price == null) return null;
    return {
      price, currency: j.currency || null, changePct: U.num(j.percent_change),
      name: j.name || null, exchange: j.exchange || null,
      fiftyTwoHigh: U.num(j.fifty_two_week && j.fifty_two_week.high),
      fiftyTwoLow: U.num(j.fifty_two_week && j.fifty_two_week.low),
      source: 'Twelve Data', asOf: j.datetime || U.isoDate()
    };
  }
  async _quoteFinnhub(symbol) {
    if (!this.keys.finnhub) return null;
    const j = await this.throttle('fh', 1100, () => this.getJSON(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${this.keys.finnhub}`));
    const price = U.num(j && j.c);
    if (!price) return null;
    return {
      price, currency: null, changePct: U.num(j.dp), previousClose: U.num(j.pc),
      source: 'Finnhub', asOf: j.t ? U.isoDate(j.t * 1000) : U.isoDate()
    };
  }
  async _quoteAlpha(symbol) {
    if (!this.keys.alphavantage) return null;
    const j = await this.throttle('av', 13000, () => this.getJSON(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${this.keys.alphavantage}`));
    const q = j && j['Global Quote'];
    const price = U.num(q && q['05. price']);
    if (price == null) return null;
    return {
      price, changePct: U.num(String(q['10. change percent'] || '').replace('%', '')),
      source: 'Alpha Vantage', asOf: q['07. latest trading day'] || U.isoDate()
    };
  }

  /* ==================================================== SÉRIE HISTORIQUE */
  async series(symbol, opts) {
    opts = opts || {};
    const key = 's:' + symbol;
    if (opts.force) this.cache.delete(key);
    return this.cached(key, TTL.series, async () => {
      let closes = null, src = null;
      if (this.keys.twelvedata) {
        try {
          const j = await this.throttle('td', 8000, () => this.getJSON(
            `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}` +
            `&interval=1day&outputsize=1300&apikey=${this.keys.twelvedata}`, 25000));
          if (j && Array.isArray(j.values) && j.values.length > 30) {
            closes = j.values.map(v => ({ d: v.datetime, c: U.num(v.close) }))
              .filter(v => v.c != null).reverse();
            src = 'Twelve Data';
          }
        } catch (e) { /* secours */ }
      }
      if (!closes && this.keys.alphavantage) {
        try {
          const j = await this.throttle('av', 13000, () => this.getJSON(
            `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}` +
            `&outputsize=full&apikey=${this.keys.alphavantage}`, 30000));
          const ts = j && j['Time Series (Daily)'];
          if (ts) {
            closes = Object.keys(ts).sort().map(d => ({ d, c: U.num(ts[d]['4. close']) })).filter(v => v.c != null);
            src = 'Alpha Vantage';
          }
        } catch (e) { /* rien */ }
      }
      if (!closes || closes.length < 30) return null;
      const stats = computeStats(closes);
      // On ne renvoie pas les 1 300 clôtures au navigateur : seules les
      // statistiques et un échantillon pour tracer une courbe.
      return Object.assign({
        source: src, asOf: closes[closes.length - 1].d,
        sample: sampleSeries(closes, 200)
      }, stats);
    });
  }

  /* ======================================================= FONDAMENTAUX */
  async fundamentals(symbol, opts) {
    opts = opts || {};
    const key = 'f:' + symbol;
    if (opts.force) this.cache.delete(key);
    return this.cached(key, TTL.fundamentals, async () => {
      const sources = [];
      const merged = {};
      for (const fn of ['_fundFinnhub', '_fundAlpha']) {
        try {
          const v = await this[fn](symbol);
          if (v) {
            sources.push({ name: v._source, asOf: v._asOf });
            Object.keys(v).forEach(k => {
              if (k.charAt(0) === '_') return;
              if (merged[k] === undefined) merged[k] = v[k];
            });
          }
        } catch (e) { /* suivant */ }
      }
      if (!sources.length) return null;
      merged._sources = sources;
      merged._asOf = sources[0].asOf;
      merged._source = sources.map(s => s.name).join(' + ');
      if (merged.peg == null && merged.pe != null && merged.epsGrowth > 0) {
        merged.peg = merged.pe / merged.epsGrowth;
        merged._pegDerived = true;
      }
      return merged;
    });
  }
  async _fundFinnhub(symbol) {
    if (!this.keys.finnhub) return null;
    let metric = null, profile = null;
    try {
      const j = await this.throttle('fh', 1100, () => this.getJSON(
        `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${this.keys.finnhub}`));
      metric = j && j.metric;
    } catch (e) { /* offre payante ou indisponible */ }
    try {
      const p = await this.throttle('fh', 1100, () => this.getJSON(
        `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${this.keys.finnhub}`));
      if (p && p.name) profile = p;
    } catch (e) { /* rien */ }
    if (!metric && !profile) return null;
    const m = metric || {};
    const pick = (...keys) => { for (const k of keys) { const v = U.num(m[k]); if (v != null) return v; } return null; };
    return clean({
      name: profile && profile.name,
      sector: profile && profile.finnhubIndustry,
      country: profile && profile.country,
      currency: profile && profile.currency,
      marketCap: profile && U.num(profile.marketCapitalization),
      pe: pick('peTTM', 'peBasicExclExtraTTM', 'peNormalizedAnnual'),
      pb: pick('pbQuarterly', 'pbAnnual'),
      ps: pick('psTTM'),
      evEbitda: pick('evEbitdaTTM'),
      dividendYield: pick('currentDividendYieldTTM', 'dividendYieldIndicatedAnnual'),
      payout: pick('payoutRatioTTM'),
      netMargin: pick('netProfitMarginTTM', 'netProfitMarginAnnual'),
      operMargin: pick('operatingMarginTTM', 'operatingMarginAnnual'),
      grossMargin: pick('grossMarginTTM', 'grossMarginAnnual'),
      roe: pick('roeTTM', 'roeRfy'),
      roa: pick('roaTTM', 'roaRfy'),
      roic: pick('roiTTM', 'roiAnnual'),
      debtToEquity: pick('totalDebt/totalEquityQuarterly', 'totalDebt/totalEquityAnnual'),
      currentRatio: pick('currentRatioQuarterly', 'currentRatioAnnual'),
      revenueGrowth: pick('revenueGrowthTTMYoy', 'revenueGrowthQuarterlyYoy'),
      revenueGrowth5Y: pick('revenueGrowth5Y'),
      epsGrowth: pick('epsGrowthTTMYoy', 'epsGrowthQuarterlyYoy'),
      epsGrowth5Y: pick('epsGrowth5Y'),
      beta: pick('beta'),
      high52: pick('52WeekHigh'), low52: pick('52WeekLow'),
      _source: 'Finnhub', _asOf: U.isoDate()
    });
  }
  async _fundAlpha(symbol) {
    if (!this.keys.alphavantage) return null;
    const j = await this.throttle('av', 13000, () => this.getJSON(
      `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(symbol)}&apikey=${this.keys.alphavantage}`));
    if (!j || !j.Symbol) return null;
    const pct = v => { const n = U.num(v); return n == null ? null : n * 100; };
    return clean({
      name: j.Name, sector: j.Sector, country: j.Country, currency: j.Currency,
      marketCap: U.num(j.MarketCapitalization) ? U.num(j.MarketCapitalization) / 1e6 : null,
      pe: U.num(j.PERatio), peg: U.num(j.PEGRatio), pb: U.num(j.PriceToBookRatio),
      ps: U.num(j.PriceToSalesRatioTTM), evEbitda: U.num(j.EVToEBITDA),
      dividendYield: pct(j.DividendYield), eps: U.num(j.EPS),
      netMargin: pct(j.ProfitMargin), operMargin: pct(j.OperatingMarginTTM),
      roe: pct(j.ReturnOnEquityTTM), roa: pct(j.ReturnOnAssetsTTM),
      revenueGrowth: pct(j.QuarterlyRevenueGrowthYOY),
      epsGrowth: pct(j.QuarterlyEarningsGrowthYOY),
      beta: U.num(j.Beta), high52: U.num(j['52WeekHigh']), low52: U.num(j['52WeekLow']),
      bookValue: U.num(j.BookValue), revenueTTM: U.num(j.RevenueTTM),
      _source: 'Alpha Vantage', _asOf: j.LatestQuarter || U.isoDate()
    });
  }

  /* ============================================================== CHANGE */
  async fx(from, to) {
    from = String(from || 'EUR').toUpperCase(); to = String(to || 'EUR').toUpperCase();
    if (from === to) return { rate: 1, source: '—', asOf: U.isoDate() };
    return this.cached('fx:' + from + to, TTL.fx, async () => {
      const urls = [
        `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`,
        `https://api.frankfurter.app/latest?from=${from}&to=${to}`
      ];
      for (const url of urls) {
        try {
          const j = await this.throttle('fx', 300, () => this.getJSON(url, 10000));
          const rate = U.num(j && j.rates && j.rates[to]);
          if (rate != null) return { rate, source: 'Frankfurter (BCE)', asOf: j.date };
        } catch (e) { /* domaine suivant */ }
      }
      return null;
    });
  }
}

/* ------------------------------------------------ statistiques historiques */
function computeStats(closes) {
  const c = closes.map(x => x.c);
  const n = c.length;
  const rets = [];
  for (let i = 1; i < n; i++) if (c[i - 1] > 0) rets.push(c[i] / c[i - 1] - 1);
  const mean = rets.reduce((s, r) => s + r, 0) / (rets.length || 1);
  const varc = rets.reduce((s, r) => s + (r - mean) * (r - mean), 0) / (rets.length - 1 || 1);
  const volAnn = Math.sqrt(varc) * Math.sqrt(252) * 100;

  let peak = c[0], maxDD = 0;
  for (const x of c) { if (x > peak) peak = x; const dd = (x / peak - 1) * 100; if (dd < maxDD) maxDD = dd; }

  const perfOver = days => {
    if (n <= days) return null;
    const past = c[n - 1 - days];
    return past > 0 ? (c[n - 1] / past - 1) * 100 : null;
  };
  const years = (n - 1) / 252;
  const cagr = (years >= 0.9 && c[0] > 0) ? (Math.pow(c[n - 1] / c[0], 1 / years) - 1) * 100 : null;
  const sharpe = (cagr != null && volAnn > 0) ? (cagr - 2) / volAnn : null;

  return {
    volAnn, maxDD, cagr, sharpe, years,
    perf1m: perfOver(21), perf6m: perfOver(126), perf1y: perfOver(252),
    perf3y: perfOver(756), perf5y: perfOver(1260),
    last: c[n - 1], first: c[0], points: n
  };
}
/** Réduit la série à ~max points pour l'affichage, en gardant le dernier. */
function sampleSeries(closes, max) {
  const n = closes.length;
  if (n <= max) return closes;
  const step = Math.ceil(n / max);
  const out = [];
  for (let i = 0; i < n; i += step) out.push(closes[i]);
  if (out[out.length - 1] !== closes[n - 1]) out.push(closes[n - 1]);
  return out;
}
function clean(o) {
  const out = {};
  Object.keys(o).forEach(k => {
    const v = o[k];
    if (v !== null && v !== undefined && v !== '' && v !== 'None') out[k] = v;
  });
  return out;
}

module.exports = { Providers, computeStats, sampleSeries, TTL };
