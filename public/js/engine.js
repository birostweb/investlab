/* ============================================================================
   engine.js — Moteurs d'analyse InvestAI
   Principes appliqués :
   · Règle 4  : un ETF n'est jamais classé sur la seule performance passée.
   · Règle 5  : aucune affirmation qu'une action « va monter ».
   · Règle 13 : toute donnée porte source + date ; aucune valeur inventée.
   · Règle 14 : on cherche le meilleur rapport qualité/risque/valorisation/
                adéquation au portefeuille existant.
   · Règle 15 : niveau de confiance calculé, et aveu d'ignorance si besoin.
   ========================================================================== */
(function (G) {
  'use strict';
  const D = () => G.DATA;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const has = v => v !== null && v !== undefined && isFinite(v);

  /** Interpolation linéaire d'un score 0→10 entre deux bornes.
   *  `bad` = valeur donnant 0, `good` = valeur donnant 10 (bad peut être > good). */
  function scale(v, bad, good) {
    if (!has(v)) return null;
    const t = (v - bad) / (good - bad);
    return clamp(t, 0, 1) * 10;
  }

  /* ====================================================== NIVEAU DE CONFIANCE */
  /** Confiance = couverture des données × fraîcheur × fiabilité de la source.
   *  Renvoie un score /100 ET les raisons, pour pouvoir les afficher (règle 15). */
  function confidence(parts) {
    // parts: [{label, weight, present, asOf, verified}]
    let wTotal = 0, wGot = 0;
    const missing = [], stale = [], unverified = [];
    const today = Date.now();
    parts.forEach(p => {
      const w = p.weight || 1;
      wTotal += w;
      if (!p.present) { missing.push(p.label); return; }
      let credit = 1;
      if (p.asOf) {
        const age = (today - new Date(p.asOf).getTime()) / 86400e3;
        if (isFinite(age)) {
          if (age > 400) { credit *= .55; stale.push(p.label + ' (' + Math.round(age) + " j)"); }
          else if (age > 120) { credit *= .8; stale.push(p.label + ' (' + Math.round(age) + ' j)'); }
          else if (age > 30) credit *= .93;
        }
      }
      if (p.verified === false) { credit *= .75; unverified.push(p.label); }
      wGot += w * credit;
    });
    const score = wTotal ? Math.round((wGot / wTotal) * 100) : 0;
    const reasons = [];
    if (missing.length) reasons.push('données absentes : ' + missing.join(', '));
    if (stale.length) reasons.push('données anciennes : ' + stale.join(', '));
    if (unverified.length) reasons.push('fiches de référence non vérifiées : ' + unverified.join(', '));
    if (!reasons.length) reasons.push('toutes les données nécessaires sont présentes et récentes');
    return { score, reasons, missing, enough: score >= 45 };
  }

  /* ================================================ EXPOSITIONS LOOK-THROUGH */
  /** Décompose le portefeuille en expositions géographiques et sectorielles
   *  réelles, en « regardant à travers » les ETF via leur fiche indice.       */
  function exposures(snap) {
    const geo = {}, sector = {}, assetClass = {};
    let covered = 0, uncovered = 0;
    const add = (bag, k, v) => { if (!k) return; bag[k] = (bag[k] || 0) + v; };

    snap.holdings.forEach(h => {
      const v = h._value; if (v <= 0) return;
      if (h.type === 'etf') {
        const cat = G.Store.findCatalog(h.catalogId || h.ticker || h.isin);
        if (cat && Object.keys(cat.geo || {}).length) {
          Object.entries(cat.geo).forEach(([k, w]) => add(geo, k, v * w / 100));
          Object.entries(cat.sector || {}).forEach(([k, w]) => add(sector, k, v * w / 100));
          add(assetClass, cat.assetClass || 'ETF', v);
          covered += v;
        } else {
          add(geo, 'Non renseigné', v); add(sector, 'Non renseigné', v);
          add(assetClass, 'ETF non identifié', v); uncovered += v;
        }
      } else {
        if (h.region || h.sector) {
          add(geo, h.region || 'Non renseigné', v);
          add(sector, h.sector || 'Non renseigné', v);
          if (!h.region || !h.sector) uncovered += v; else covered += v;
        } else { add(geo, 'Non renseigné', v); add(sector, 'Non renseigné', v); uncovered += v; }
        add(assetClass, 'Actions en direct', v);
      }
    });

    // immobilier participatif
    G.Store.state.bricks.filter(b => b.status !== 'remboursé' && b.status !== 'perdu').forEach(b => {
      const v = Number(b.amount) || 0; if (v <= 0) return;
      add(geo, b.country || 'France', v);
      add(sector, 'Immobilier', v);
      add(assetClass, 'Immobilier participatif', v);
      covered += v;
    });
    // les liquidités ne font pas partie du patrimoine suivi (autre compte)

    const pct = bag => {
      const tot = Object.values(bag).reduce((s, x) => s + x, 0);
      return Object.entries(bag)
        .map(([k, v]) => ({ key: k, value: v, pct: tot ? v / tot * 100 : 0 }))
        .sort((a, b) => b.pct - a.pct);
    };
    const base = covered + uncovered;
    return {
      geo: pct(geo), sector: pct(sector), assetClass: pct(assetClass),
      coverage: base ? covered / base * 100 : 0
    };
  }

  /* ============================================== ANALYSE DU PORTEFEUILLE */
  function analysePortfolio() {
    const snap = G.Store.snapshot();
    const st = G.Store.state;
    const prof = snap.profile;
    const exp = exposures(snap);

    /* --- Concentration mesurée EN TRANSPARENCE.
       Une ligne de 40 % sur un fonds de 1 350 sociétés n'a rien à voir avec
       40 % sur un titre unique. On pondère donc chaque ligne par le nombre
       « effectif » de sociétés qu'elle contient : pour un indice pondéré par
       les capitalisations, on approxime ce nombre par holdings^0,6 (un MSCI
       World compte ~1 350 lignes mais se comporte comme ~75 lignes égales). */
    const effN = (h) => {
      if (h.type !== 'etf') return 1;
      const c = G.Store.findCatalog(h.catalogId || h.ticker || h.isin);
      if (!c || !has(c.holdings)) return 1;         // composition inconnue : prudence
      return Math.max(1, Math.pow(c.holdings, 0.6));
    };
    /** Limite applicable à une ligne : un satellite est plafonné bas, un socle
     *  mondial n'a pas de raison de l'être. */
    const limitFor = (h) => {
      if (h.type !== 'etf') return prof.maxSinglePosition;
      const c = G.Store.findCatalog(h.catalogId || h.ticker || h.isin);
      return c && has(c.maxWeight) ? c.maxWeight : prof.maxSinglePosition;
    };

    const riskyLines = snap.holdings.filter(h => h._value > 0)
      .map(h => ({ label: h.name || h.ticker, value: h._value, n: effN(h), limit: limitFor(h) }))
      .concat(st.bricks.filter(b => b.status !== 'remboursé' && b.status !== 'perdu' && (Number(b.amount) || 0) > 0)
        .map(b => ({ label: b.name || 'Projet immobilier', value: Number(b.amount) || 0, n: 1, limit: prof.maxSinglePosition })));

    const riskyTotal = riskyLines.reduce((s, l) => s + l.value, 0);
    const hhi = riskyTotal ? riskyLines.reduce((s, l) => s + ((l.value / riskyTotal) ** 2) / l.n, 0) : 1;
    const effectiveLines = hhi ? 1 / hhi : 0;      // nombre effectif d'expositions
    const topLine = riskyTotal ? riskyLines.slice().sort((a, b) => b.value - a.value)[0] : null;
    const topWeight = topLine ? topLine.value / riskyTotal * 100 : 0;
    // lignes qui dépassent réellement LEUR propre limite
    const overweight = riskyLines
      .map(l => ({ l, w: l.value / (riskyTotal || 1) * 100 }))
      .filter(x => x.w > x.l.limit)
      .sort((a, b) => (b.w - b.l.limit) - (a.w - a.l.limit));

    // --- diversification interne réelle (look-through des ETF)
    const under = arr => {
      const t = arr.reduce((s, x) => s + (x.pct / 100) ** 2, 0);
      return t ? 1 / t : 0;
    };
    const geoEff = under(exp.geo), secEff = under(exp.sector);

    // --- nombre de titres sous-jacents réellement détenus
    let underlying = 0;
    snap.holdings.forEach(h => {
      if (h.type === 'etf') {
        const c = G.Store.findCatalog(h.catalogId || h.ticker || h.isin);
        underlying += (c && c.holdings) ? c.holdings : 0;
      } else underlying += 1;
    });

    // --- score de diversification /100 : cinq dimensions
    const sLines = scale(Math.log10(Math.max(effectiveLines, 1)), 0, 1.9); // équilibre en transparence
    const sGeo = scale(geoEff, 1, 5);                      // dispersion géographique
    const sSector = scale(secEff, 1, 8);                   // dispersion sectorielle
    const sUnder = scale(Math.log10(Math.max(underlying, 1)), 0, 3.2); // profondeur
    const sClass = scale(exp.assetClass.length, 1, 4);     // classes d'actifs
    const parts = [sLines, sGeo, sSector, sUnder, sClass].filter(has);
    const divScore = parts.length ? Math.round(parts.reduce((s, x) => s + x, 0) / parts.length * 10) : 0;

    // --- niveau de risque estimé, à partir des volatilités réelles quand on les a
    let volSum = 0, volW = 0, volKnown = 0;
    snap.holdings.forEach(h => {
      const s = st.cache.series[(h.ticker || '').toUpperCase()];
      if (s && s.v && has(s.v.volAnn)) { volSum += s.v.volAnn * h._value; volW += h._value; volKnown += h._value; }
    });
    // hypothèses de repli explicites si l'historique manque
    /* Hypothèses de repli, affichées comme telles. La crypto est de très loin
       la classe la plus volatile : la traiter comme une action sous-estimerait
       gravement le risque du portefeuille. */
    const fallbackVol = { etf: 14, actions: 26, crypto: 70, immobilier: 8 };
    let assumedVol = 0;
    snap.holdings.forEach(h => {
      const s = st.cache.series[(h.ticker || '').toUpperCase()];
      if (!(s && s.v && has(s.v.volAnn))) {
        assumedVol += (fallbackVol[h.type] || fallbackVol.actions) * h._value;
        volW += h._value;
      }
    });
    volW += snap.bricksValue;
    assumedVol += fallbackVol.immobilier * snap.bricksValue;
    const portVol = volW ? (volSum + assumedVol) / volW : null;
    const volMeasured = volW ? volKnown / volW * 100 : 0;

    let riskLabel = 'Non évaluable';
    if (has(portVol)) {
      riskLabel = portVol < 7 ? 'Faible' : portVol < 13 ? 'Modéré' : portVol < 19 ? 'Modéré à élevé' : 'Élevé';
    }
    // Concentration jugée sur le nombre effectif d'expositions, pas sur le
    // poids brut d'une ligne : c'est ce qui reflète le risque réellement pris.
    const concentrationLabel = overweight.length ? 'Élevée'
      : effectiveLines >= 25 ? 'Faible' : effectiveLines >= 8 ? 'Modérée' : 'Élevée';

    // --- écarts à l'allocation cible
    const drift = ['etf', 'actions', 'crypto', 'immobilier'].map(k => ({
      key: k, actual: snap.alloc[k] || 0, target: snap.target[k] || 0,
      gap: (snap.alloc[k] || 0) - (snap.target[k] || 0)
    }));

    // --- constats classés par gravité → « ce que je changerais »
    const issues = [];
    const push = (sev, title, detail, action) => issues.push({ sev, title, detail, action });

    if (snap.total <= 0) push(3, 'Portefeuille vide', 'Aucune position enregistrée.', 'Ajoute tes positions réelles pour que les analyses aient un sens.');
    overweight.slice(0, 2).forEach(x => {
      push(3, 'Ligne trop lourde',
        `${x.l.label} pèse ${x.w.toFixed(1)} % de tes actifs risqués, au-delà de la part raisonnable pour ce type d'actif (${x.l.limit} %).`,
        'Oriente les prochains versements ailleurs plutôt que de vendre : le poids se dilue mécaniquement.');
    });
    const topSector = exp.sector.filter(s => s.key !== 'Non renseigné')[0];
    if (topSector && topSector.pct > prof.maxSectorExposure) {
      push(3, 'Surexposition sectorielle',
        `${topSector.key} représente ${topSector.pct.toFixed(1)} % de ton exposition, contre une limite de ${prof.maxSectorExposure} % pour ton profil.`,
        'Évite d\'ajouter du ' + topSector.key.toLowerCase() + ' : privilégie les secteurs sous-représentés ou un ETF large.');
    }
    const topGeo = exp.geo.filter(s => s.key !== 'Non renseigné')[0];
    if (topGeo && topGeo.pct > 78) {
      push(2, 'Forte dépendance à une zone',
        `${topGeo.key} pèse ${topGeo.pct.toFixed(1)} % de ton exposition actions.`,
        'Un ETF Europe ou émergents réduirait cette dépendance géographique.');
    }
    drift.forEach(d => {
      const lbl = { etf: 'ETF', actions: 'Actions', crypto: 'Crypto', immobilier: 'Immobilier' }[d.key];
      if (Math.abs(d.gap) >= 10) push(2, `Écart d'allocation : ${lbl}`,
        `${d.actual.toFixed(1)} % réel contre ${d.target} % visé (écart de ${d.gap > 0 ? '+' : ''}${d.gap.toFixed(1)} points).`,
        d.gap > 0 ? `Redirige tes prochains versements hors ${lbl.toLowerCase()}.` : `Concentre tes prochains versements sur ${lbl.toLowerCase()}.`);
      else if (Math.abs(d.gap) >= 5) push(1, `Léger écart : ${lbl}`,
        `${d.actual.toFixed(1)} % contre ${d.target} % visé.`,
        'Écart faible : un simple ajustement des versements suffit, aucune vente nécessaire.');
    });
    if (effectiveLines < 12 && riskyTotal > 0) push(2, 'Trop peu d\'expositions effectives',
      `Une fois les ETF décomposés, le portefeuille se comporte comme s'il ne contenait que ${effectiveLines.toFixed(0)} exposition(s) équivalente(s).`,
      'Un ETF monde large apporte immédiatement plusieurs dizaines d\'expositions effectives.');
    const maxCrypto = snap.profile.maxCryptoSleeve || 15;
    if (snap.alloc.crypto > maxCrypto) push(2, 'Poche crypto au-dessus de ta tolérance',
      `${snap.alloc.crypto.toFixed(1)} % du patrimoine est en cryptoactifs, pour un maximum de ${maxCrypto} % sur un profil ${snap.profile.label.toLowerCase()}.`,
      'La crypto ne verse aucun revenu et sa volatilité dépasse largement celle des actions. Réorienter les prochains versements suffit à faire redescendre le poids sans vendre.');
    // on part du snapshot : ses lignes portent déjà la valeur calculée
    const aujourdhui = G.Store.todayISO();
    const bloquees = snap.holdings.filter(h => h.stakingUntil && h.stakingUntil > aujourdhui);
    if (bloquees.length) {
      const val = bloquees.reduce((a, h) => a + h._value, 0);
      const fin = bloquees.map(h => h.stakingUntil).sort().pop();
      const part = snap.total > 0 ? val / snap.total * 100 : 0;
      push(part > 25 ? 2 : 1, 'Positions immobilisées',
        `${bloquees.map(h => h.ticker).join(', ')} — ${fmtE(val)} (${part.toFixed(1)} % du patrimoine) bloqués jusqu'au ${fin}.`,
        'Un rendement de staking rémunère d\'abord cette immobilisation : tu ne peux ni vendre ni arbitrer d\'ici là, quoi que fasse le cours. Le rendement est par ailleurs versé dans le jeton lui-même, dont la valeur varie.');
    }
    const stables = snap.holdings.filter(h => h.type === 'crypto' && (G.Store.cryptoMeta(h.ticker) || {}).cap === 'stable');
    const stablesVal = stables.reduce((a, h) => a + h._value, 0);
    if (snap.cryptoValue > 0 && stablesVal / snap.cryptoValue > 0.5) push(1, 'Poche crypto surtout en stablecoins',
      `${(stablesVal / snap.cryptoValue * 100).toFixed(0)} % de ta poche crypto est en stablecoins.`,
      'Un stablecoin ne progresse pas : c\'est de la trésorerie exposée au risque de l\'émetteur et de la plateforme, pas un investissement.');
    if (exp.coverage < 70 && riskyTotal > 0) push(1, 'Données de composition incomplètes',
      `Seulement ${exp.coverage.toFixed(0)} % du portefeuille a une composition connue.`,
      'Renseigne le secteur/la région de tes actions et rattache tes ETF au catalogue pour fiabiliser l\'analyse.');
    if (volMeasured < 50 && snap.holdings.length) push(1, 'Volatilité partiellement estimée',
      `Seuls ${volMeasured.toFixed(0)} % du portefeuille ont un historique de prix réel ; le reste utilise des hypothèses affichées.`,
      'Renseigne une clé Twelve Data pour mesurer le risque sur données réelles.');

    issues.sort((a, b) => b.sev - a.sev);

    const conf = confidence([
      { label: 'valorisation des positions', weight: 3, present: snap.holdings.every(h => h._live) && snap.holdings.length > 0 },
      { label: 'composition des ETF', weight: 2, present: exp.coverage > 70, verified: false },
      { label: 'historique de prix', weight: 2, present: volMeasured > 50 },
      { label: 'allocation cible', weight: 1, present: Object.values(snap.target).reduce((s, v) => s + v, 0) > 0 }
    ]);

    return {
      snap, exp, divScore, riskLabel, portVol, volMeasured, concentrationLabel, topWeight,
      effectiveLines, underlying, geoEff, secEff, drift, issues, confidence: conf,
      breakdown: { lignes: sLines, geographie: sGeo, secteurs: sSector, profondeur: sUnder, classes: sClass }
    };
  }

  /* ================================================== SCORE D'UN ETF (/100) */
  /** `ctx` = { snap, exp } pour mesurer l'apport marginal au portefeuille. */
  async function scoreEtf(cat, ctx, opts) {
    opts = opts || {};
    const prof = ctx.snap.profile;
    const W = prof.weights;
    const st = await (opts.noNetwork ? Promise.resolve(null) : G.Market.series(cat.ticker));

    /* -- 1. Frais : décisif sur le long terme */
    const sFees = has(cat.ter) ? scale(cat.ter, 0.60, 0.05) : null;

    /* -- 2. Diversification structurelle */
    const nH = cat.holdings;
    const sHold = has(nH) ? scale(Math.log10(Math.max(nH, 1)), 1.3, 3.4) : null;
    const geoSpread = Object.keys(cat.geo || {}).length;
    const secSpread = Object.keys(cat.sector || {}).length;
    const topGeoW = Math.max(0, ...Object.values(cat.geo || { x: 100 }));
    const topSecW = Math.max(0, ...Object.values(cat.sector || { x: 100 }));
    const sSpread = [scale(geoSpread, 1, 6), scale(secSpread, 1, 10),
                     scale(topGeoW, 100, 35), scale(topSecW, 60, 15)]
                    .filter(has);
    const sDiv = (has(sHold) ? [sHold] : []).concat(sSpread).length
      ? ((has(sHold) ? sHold : 0) * (has(sHold) ? 1 : 0) + sSpread.reduce((s, x) => s + x, 0))
        / ((has(sHold) ? 1 : 0) + sSpread.length)
      : null;

    /* -- 3. Encours / liquidité (en M€) */
    const sAum = has(cat.aum) ? scale(Math.log10(Math.max(cat.aum, 1)), 1.7, 4.3) : null;

    /* -- 4. Antériorité du fonds */
    const age = cat.incepted ? (new Date().getFullYear() - cat.incepted) : null;
    const sTrack = has(age) ? scale(age, 0, 12) : null;

    /* -- 5. Rendement ajusté du risque — SUR DONNÉES RÉELLES uniquement.
           Règle 4 : la performance brute n'est jamais l'unique critère, et
           elle n'entre ici que corrigée du risque, plafonnée par les poids. */
    let sRisk = null, riskDetail = null;
    if (st && has(st.volAnn)) {
      const volFit = scale(st.volAnn, prof.volTolerance * 2.2, prof.volTolerance * 0.55);
      const ddFit = has(st.maxDD) ? scale(Math.abs(st.maxDD), prof.maxDrawdownTolerance * 1.7, prof.maxDrawdownTolerance * 0.5) : null;
      const shFit = has(st.sharpe) ? scale(st.sharpe, -0.2, 1.0) : null;
      const arr = [volFit, ddFit, shFit].filter(has);
      sRisk = arr.reduce((s, x) => s + x, 0) / arr.length;
      riskDetail = { vol: st.volAnn, maxDD: st.maxDD, cagr: st.cagr, sharpe: st.sharpe, years: st.years, source: st.source, asOf: st.asOf };
    }

    /* -- 6. Adéquation à MON portefeuille (règle 2 : jamais sans regarder ce que je possède) */
    const fit = fitScore(cat, ctx);

    /* -- 7. Rôle dans un portefeuille de long terme.
           Empêche un fonds de niche de passer devant un socle mondial au seul
           motif qu'il diversifie : un satellite reste un satellite.          */
    const sRole = has(cat.core) ? cat.core : 5;

    /* -- agrégation pondérée sur les composantes disponibles */
    const comps = [
      { k: 'Frais', v: sFees, w: W.fees },
      { k: 'Diversification', v: sDiv, w: W.diversification },
      { k: 'Encours', v: sAum, w: W.aum },
      { k: 'Antériorité', v: sTrack, w: W.track },
      { k: 'Rendement/risque', v: sRisk, w: W.riskAdj },
      { k: 'Apport portefeuille', v: fit.score, w: W.fit },
      { k: 'Rôle long terme', v: sRole, w: W.role }
    ];
    const avail = comps.filter(c => has(c.v));
    const wSum = avail.reduce((s, c) => s + c.w, 0);
    const score = wSum ? Math.round(avail.reduce((s, c) => s + c.v * c.w, 0) / wSum * 10) : null;

    const conf = confidence([
      { label: 'frais (TER)', weight: 2, present: has(cat.ter), verified: cat.verified },
      { label: 'composition de l\'indice', weight: 2, present: geoSpread > 0, verified: cat.verified },
      { label: 'encours', weight: 1, present: has(cat.aum), verified: cat.verified },
      { label: 'historique de prix', weight: 3, present: !!st, asOf: st && st.asOf },
      { label: 'mon portefeuille', weight: 2, present: ctx.snap.total > 0 }
    ]);

    return {
      cat, score, components: comps, stats: riskDetail, fit, confidence: conf,
      missingSeries: !st
    };
  }

  /** Apport marginal : à quel point cet actif diversifie ce que je détiens déjà. */
  function fitScore(cat, ctx) {
    const exp = ctx.exp;
    const toMap = arr => { const m = {}; arr.forEach(x => m[x.key] = x.pct); return m; };
    const pfGeo = toMap(exp.geo), pfSec = toMap(exp.sector);
    const overlap = (etfBag, pfBag) => {
      const keys = new Set(Object.keys(etfBag || {}).concat(Object.keys(pfBag || {})));
      let ov = 0;
      keys.forEach(k => ov += Math.min(etfBag[k] || 0, pfBag[k] || 0));
      return ov;                                  // 0 = aucun recouvrement, 100 = identique
    };
    const reasons = [];
    let score = 5;

    if (ctx.snap.total <= 0) {
      return { score: 6.5, overlapGeo: null, overlapSec: null,
        reasons: ['Portefeuille encore vide : un fonds large et peu cher constitue le socle naturel.'] };
    }
    const ovG = overlap(cat.geo, pfGeo), ovS = overlap(cat.sector, pfSec);
    // moins de recouvrement = plus d'apport
    const sG = scale(ovG, 95, 25), sS = scale(ovS, 95, 30);
    score = ((has(sG) ? sG : 5) + (has(sS) ? sS : 5)) / 2;

    /* Un apport de diversification ne vaut que jusqu'à la part raisonnable du
       fonds : au-delà, diversifier davantage vers une niche AJOUTE du risque.
       On ramène donc le bonus vers la moyenne pour les fonds satellites.     */
    const maxW = has(cat.maxWeight) ? cat.maxWeight : 25;
    if (maxW < 100 && score > 5) {
      const damp = clamp(maxW / 100, 0.25, 1);
      score = 5 + (score - 5) * damp;
      if (maxW <= 15) reasons.push(`Fonds satellite : au-delà d'environ ${maxW} % du portefeuille, il ajoute plus de risque qu'il n'apporte de diversification.`);
    }

    if (ovG < 45) reasons.push(`Faible recouvrement géographique avec ton portefeuille (${ovG.toFixed(0)} %) : apport réel de diversification.`);
    else if (ovG > 80) reasons.push(`Recouvrement géographique élevé (${ovG.toFixed(0)} %) : tu détiens déjà largement cette exposition.`);
    if (ovS > 80) reasons.push(`Recouvrement sectoriel élevé (${ovS.toFixed(0)} %) : peu de nouveauté dans ton allocation.`);

    // pénalité si le poids de l'actif est déjà important
    const already = ctx.snap.holdings
      .filter(h => (h.catalogId && h.catalogId === cat.id) || (h.ticker || '').toUpperCase() === (cat.ticker || '').toUpperCase())
      .reduce((s, h) => s + h._value, 0);
    /* La limite applicable est celle du FONDS (maxWeight), pas la limite
       générique par ligne : un ETF monde à 27 % du patrimoine n'a rien d'une
       sur-concentration, contrairement à un ETF sectoriel au même poids.    */
    if (already > 0) {
      const w = already / ctx.snap.total * 100;
      if (w > maxW) {
        score = Math.min(score, 2);
        reasons.push(`Tu en détiens déjà ${w.toFixed(1)} % du patrimoine, au-delà de la part raisonnable pour ce type de fonds (≈ ${maxW} %).`);
      } else {
        score = Math.min(score, 6.5);
        reasons.push(`Ligne déjà présente (${w.toFixed(1)} % du patrimoine) : renforcer reste cohérent, mais n'améliore pas ta diversification.`);
      }
    }
    // bonus si la poche ETF est sous son objectif
    const gap = (ctx.snap.target.etf || 0) - (ctx.snap.alloc.etf || 0);
    if (gap > 5) { score = Math.min(10, score + 1); reasons.push(`Ta poche ETF est ${gap.toFixed(1)} points sous son objectif : de la place existe pour renforcer.`); }
    if (gap < -8) { score = Math.max(0, score - 1.5); reasons.push(`Ta poche ETF dépasse déjà son objectif de ${(-gap).toFixed(1)} points.`); }

    return { score: clamp(score, 0, 10), overlapGeo: ovG, overlapSec: ovS, reasons };
  }

  /** Classement des ETF pour mon profil. */
  async function rankEtfs(filter, limit) {
    const snap = G.Store.snapshot();
    const ctx = { snap, exp: exposures(snap) };
    let list = G.Store.etfCatalog();
    if (filter === 'pea') list = list.filter(e => e.pea);
    if (filter === 'cto') list = list.filter(e => !e.pea);
    const scored = [];
    for (const cat of list) scored.push(await scoreEtf(cat, ctx));
    scored.sort((a, b) => (b.score || 0) - (a.score || 0));
    return { ranked: limit ? scored.slice(0, limit) : scored, ctx };
  }

  /* =============================================== SCORE D'UNE ACTION (/100) */
  /** Sous-scores /10 exactement comme demandé : croissance, rentabilité,
   *  valorisation, dette, qualité, risque. */
  async function scoreStock(ticker, opts) {
    opts = opts || {};
    const snap = opts.snap || G.Store.snapshot();
    const ctx = { snap, exp: opts.exp || exposures(snap) };
    const prof = snap.profile;

    let f = await G.Market.fundamentals(ticker);
    const s = await G.Market.series(ticker);
    const q = await G.Market.quote(ticker);
    const meta = D().STOCK_UNIVERSE.find(u => u.t.toUpperCase() === ticker.toUpperCase());

    if (!f && !s) {
      return {
        ticker, name: (meta && meta.n) || ticker, noData: true,
        conclusion: D().CONCLUSIONS.NODATA,
        message: "Je n'ai pas suffisamment de données pour conclure sur " + ticker +
          '. Aucun fournisseur configuré n\'a renvoyé de fondamentaux ni d\'historique de prix.',
        confidence: { score: 0, reasons: ['aucune donnée reçue des fournisseurs'] }
      };
    }
    f = f || {};

    /* -- Croissance */
    const gRev = scale(f.revenueGrowth, -5, 20);
    const gRev5 = scale(f.revenueGrowth5Y, -2, 15);
    const gEps = scale(f.epsGrowth, -10, 25);
    const gEps5 = scale(f.epsGrowth5Y, -5, 18);
    const croissance = avg([gRev, gRev5, gEps, gEps5]);

    /* -- Rentabilité */
    const rNet = scale(f.netMargin, 0, 25);
    const rOper = scale(f.operMargin, 0, 28);
    const rRoe = scale(f.roe, 3, 28);
    const rRoic = scale(f.roic, 2, 20);
    const rentabilite = avg([rNet, rOper, rRoe, rRoic]);

    /* -- Valorisation (plus c'est cher, plus le score baisse) */
    const vPe = scale(f.pe, 45, 10);
    const vPeg = scale(f.peg, 3.0, 0.8);
    const vPb = scale(f.pb, 10, 1.2);
    const vPs = scale(f.ps, 12, 1.0);
    const vEv = scale(f.evEbitda, 30, 8);
    let valorisation = avg([vPe, vPeg, vPb, vPs, vEv]);
    // position dans le canal 52 semaines : un titre proche de ses plus hauts est
    // rarement une aubaine — signal secondaire, pondéré faiblement
    let pos52 = null;
    // bornes 52 semaines : fondamentaux d'abord, sinon celles de la cotation
    const hi52 = has(f.high52) ? f.high52 : (q && has(q.fiftyTwoHigh) ? q.fiftyTwoHigh : null);
    const lo52 = has(f.low52) ? f.low52 : (q && has(q.fiftyTwoLow) ? q.fiftyTwoLow : null);
    if (has(hi52) && has(lo52) && q && hi52 > lo52) {
      pos52 = (q.price - lo52) / (hi52 - lo52) * 100;
      const adj = scale(pos52, 100, 20);
      if (has(valorisation) && has(adj)) valorisation = valorisation * 0.82 + adj * 0.18;
    }

    /* -- Dette / solidité financière */
    const dDe = scale(f.debtToEquity, 250, 30);
    const dCur = scale(f.currentRatio, 0.7, 2.2);
    const dette = avg([dDe, dCur]);

    /* -- Qualité (marges élevées et durables, rentabilité du capital) */
    const qGross = scale(f.grossMargin, 15, 60);
    const qRoe = scale(f.roe, 5, 30);
    const qStab = s && has(s.maxDD) ? scale(Math.abs(s.maxDD), 75, 25) : null;
    const qualite = avg([qGross, qRoe, rOper, qStab]);

    /* -- Risque (volatilité réelle, bêta, drawdown, concentration chez moi) */
    const kVol = s && has(s.volAnn) ? scale(s.volAnn, prof.volTolerance * 2.6, prof.volTolerance * 0.7) : null;
    const kBeta = has(f.beta) ? scale(Math.abs(f.beta), 2.0, 0.7) : null;
    const kDd = s && has(s.maxDD) ? scale(Math.abs(s.maxDD), prof.maxDrawdownTolerance * 2, prof.maxDrawdownTolerance * 0.6) : null;
    const risque = avg([kVol, kBeta, kDd]);

    /* -- Adéquation portefeuille (règle 2) */
    const sectorKey = (meta && meta.sector) || f.sector || null;
    const already = snap.holdings.filter(h => (h.ticker || '').toUpperCase() === ticker.toUpperCase())
      .reduce((sum, h) => sum + h._value, 0);
    const alreadyPct = snap.total ? already / snap.total * 100 : 0;
    const secExp = ctx.exp.sector.find(x => x.key === sectorKey);
    const secPct = secExp ? secExp.pct : 0;
    const stockSleeve = snap.alloc.actions || 0;

    const fitReasons = [];
    let fit = 6;
    if (sectorKey && secPct > prof.maxSectorExposure) {
      fit -= 3; fitReasons.push(`Tu es déjà exposé à ${secPct.toFixed(0)} % au secteur ${sectorKey}, au-delà de ta limite de ${prof.maxSectorExposure} %.`);
    } else if (sectorKey && secPct < prof.maxSectorExposure * 0.4) {
      fit += 1.5; fitReasons.push(`Le secteur ${sectorKey} ne pèse que ${secPct.toFixed(0)} % chez toi : il y a de la place.`);
    }
    if (alreadyPct > prof.maxSinglePosition) { fit -= 3; fitReasons.push(`Cette ligne pèse déjà ${alreadyPct.toFixed(1)} % de ton patrimoine.`); }
    else if (alreadyPct > 0) { fitReasons.push(`Ligne déjà détenue (${alreadyPct.toFixed(1)} % du patrimoine).`); }
    if (stockSleeve > prof.maxStockSleeve) {
      fit -= 2.5;
      fitReasons.push(`Ta poche d'actions en direct atteint ${stockSleeve.toFixed(1)} %, au-dessus du plafond de ${prof.maxStockSleeve} % de ton profil ${prof.label.toLowerCase()}.`);
    }
    fit = clamp(fit, 0, 10);

    /* -- Score global pondéré selon le profil */
    const wProfile = {
      prudent:   { croissance:.10, rentabilite:.20, valorisation:.22, dette:.20, qualite:.18, risque:.10 },
      equilibre: { croissance:.16, rentabilite:.20, valorisation:.22, dette:.14, qualite:.18, risque:.10 },
      dynamique: { croissance:.26, rentabilite:.18, valorisation:.16, dette:.10, qualite:.18, risque:.12 }
    }[prof.key];

    const subs = { croissance, rentabilite, valorisation, dette, qualite, risque };
    const availSub = Object.entries(subs).filter(([k, v]) => has(v));
    const wSum = availSub.reduce((s, [k]) => s + wProfile[k], 0);
    let base = wSum ? availSub.reduce((s, [k, v]) => s + v * wProfile[k], 0) / wSum * 10 : null;
    // l'adéquation module le score final de ±12 points (règle 2 et 14)
    let score = has(base) ? Math.round(clamp(base + (fit - 5) * 2.4, 0, 100)) : null;

    /* -- Confiance */
    const conf = confidence([
      { label: 'compte de résultat (marges, croissance)', weight: 3, present: has(f.netMargin) || has(f.revenueGrowth), asOf: f._asOf },
      { label: 'valorisation (PER, P/B)', weight: 3, present: has(f.pe) || has(f.pb), asOf: f._asOf },
      { label: 'endettement', weight: 2, present: has(f.debtToEquity) || has(f.currentRatio), asOf: f._asOf },
      { label: 'historique de prix', weight: 2, present: !!s, asOf: s && s.asOf },
      { label: 'cours du jour', weight: 1, present: !!q, asOf: q && q.asOf },
      { label: 'mon portefeuille', weight: 1, present: snap.total > 0 }
    ]);

    /* -- Conclusion (jamais de prédiction de hausse) */
    /* Un score calculé sur deux dimensions sur six n'est pas un score : on ne
       l'affiche pas comme tel. Il reste accessible via `partialScore` pour
       expliquer le raisonnement, mais `score` devient nul (règle 15).        */
    const partialScore = score;
    const reliable = conf.enough && availSub.length >= 4;
    if (!reliable) score = null;

    let conclusion;
    if (!reliable) conclusion = D().CONCLUSIONS.NODATA;
    else if (fit <= 2.5 || (stockSleeve > prof.maxStockSleeve && alreadyPct > 0)) conclusion = D().CONCLUSIONS.UNFIT;
    else if (has(risque) && risque < 3.5) conclusion = D().CONCLUSIONS.RISKY;
    else if (has(valorisation) && valorisation < 3.5) conclusion = D().CONCLUSIONS.EXPENSIVE;
    else if (score >= 70) conclusion = D().CONCLUSIONS.INTERESTING;
    else conclusion = D().CONCLUSIONS.WATCH;

    return {
      ticker: ticker.toUpperCase(), name: f.name || (meta && meta.n) || ticker,
      sector: sectorKey, region: (meta && meta.region) || f.country || null,
      price: q ? q.price : null, priceSource: q ? q.source : null, priceAsOf: q ? q.asOf : null,
      currency: f.currency || (q && q.currency) || null,
      score, partialScore, reliable, dimensions: availSub.length,
      subs, fit, fitReasons, pos52, alreadyPct, secPct,
      fundamentals: f, stats: s ? {
        vol: s.volAnn, maxDD: s.maxDD, cagr: s.cagr, sharpe: s.sharpe, years: s.years,
        perf1y: s.perf1y, perf3y: s.perf3y, perf5y: s.perf5y, source: s.source, asOf: s.asOf
      } : null,
      confidence: conf, conclusion, sources: buildSources(f, s, q)
    };
  }

  function buildSources(f, s, q) {
    const out = [];
    if (f && f._source) out.push({ what: 'Fondamentaux', src: f._source, asOf: f._asOf });
    if (s && s.source) out.push({ what: 'Historique', src: s.source, asOf: s.asOf });
    if (q && q.source) out.push({ what: 'Cours', src: q.source, asOf: q.asOf });
    return out;
  }
  function avg(arr) {
    const a = arr.filter(has);
    return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  }

  /* ================================================== IMMOBILIER PARTICIPATIF */
  /** Règle 7 : jamais un classement sur le seul rendement annoncé. */
  function scoreBrick(b, ctx) {
    const prof = ctx.snap.profile;
    const notes = [], risks = [];

    // Rendement annoncé — plafonné : au-delà de 11 %, un rendement élevé
    // traduit d'abord un risque élevé, il ne doit pas doper le score.
    const y = Number(b.yieldPct) || 0;
    const sYield = clamp(scale(y, 4, 10), 0, 10);
    if (y > 11) { risks.push(`Rendement annoncé de ${y} % : ce niveau rémunère un risque élevé, il ne doit pas être lu comme une promesse.`); }

    // Durée : plus c'est long, moins c'est liquide
    const dur = Number(b.durationMonths) || 0;
    const sDur = scale(dur, 48, 12);
    if (dur > 36) risks.push(`Immobilisation longue (${dur} mois) sans possibilité de sortie garantie.`);

    // Garanties
    const gtxt = (b.guarantees || '').toLowerCase();
    let sGuar = 3;
    if (/hypoth[eè]que|1er rang|premier rang/.test(gtxt)) sGuar = 9;
    else if (/caution|gfa|garantie financi[eè]re|fiducie/.test(gtxt)) sGuar = 7;
    else if (/promesse|subordonn|aucune|non/.test(gtxt) || !gtxt) { sGuar = 2; risks.push('Garanties faibles ou non renseignées.'); }

    // Historique du promoteur
    const sProm = has(b.promoterTrack) ? scale(b.promoterTrack, 0, 10)
      : (b.promoter ? 4 : 2);
    if (!b.promoter) risks.push('Promoteur non renseigné : impossible d\'évaluer son historique.');

    // LTV / niveau de levier
    const sLtv = has(b.ltv) ? scale(b.ltv, 90, 50) : null;
    if (has(b.ltv) && b.ltv > 75) risks.push(`Ratio d'endettement élevé sur le projet (LTV ${b.ltv} %).`);

    // Retard déclaré
    let sStatus = 8;
    if (b.delayed) { sStatus = 2; risks.push('Projet déjà en retard : signal négatif fort sur le respect de l\'échéance.'); }
    if (b.status === 'en retard') sStatus = 2;

    // Concentration : combien pèse déjà l'immobilier chez moi
    const immoPct = ctx.snap.alloc.immobilier || 0;
    let sFit = 6;
    if (immoPct > (ctx.snap.target.immobilier || 0) + 8) { sFit = 3; notes.push(`Ta poche immobilière (${immoPct.toFixed(1)} %) dépasse déjà son objectif de ${ctx.snap.target.immobilier} %.`); }
    else if (immoPct < (ctx.snap.target.immobilier || 0) - 5) { sFit = 8; notes.push(`Ta poche immobilière est sous son objectif : de la place existe.`); }
    const sameProm = G.Store.state.bricks.filter(x => x.id !== b.id && x.promoter && b.promoter && x.promoter.toLowerCase() === b.promoter.toLowerCase());
    if (sameProm.length) { sFit = Math.min(sFit, 4); risks.push(`Tu finances déjà ${sameProm.length} autre(s) projet(s) du même promoteur : risque concentré sur une seule contrepartie.`); }

    const comps = [
      { k: 'Rendement', v: sYield, w: .22 },
      { k: 'Garanties', v: sGuar, w: .24 },
      { k: 'Promoteur', v: sProm, w: .16 },
      { k: 'Durée / liquidité', v: sDur, w: .12 },
      { k: 'Levier (LTV)', v: sLtv, w: .10 },
      { k: 'Exécution', v: sStatus, w: .06 },
      { k: 'Adéquation', v: sFit, w: .10 }
    ];
    const avail = comps.filter(c => has(c.v));
    const wSum = avail.reduce((s, c) => s + c.w, 0);
    const score = wSum ? Math.round(avail.reduce((s, c) => s + c.v * c.w, 0) / wSum * 10) : null;

    // rapport rendement / risque explicite
    const riskScore = avg([sGuar, sProm, sLtv, sStatus, sDur]);
    const ratio = has(riskScore) && riskScore > 0 ? y / (11 - riskScore) : null;

    /* Toutes ces informations sont déclaratives : elles proviennent de la
       plateforme ou de ta saisie, et rien ne permet de les recouper de façon
       indépendante. La confiance est donc structurellement plafonnée — c'est
       une caractéristique de cette classe d'actifs, pas un défaut de saisie. */
    const conf = confidence([
      { label: 'rendement et durée', weight: 2, present: y > 0 && dur > 0, verified: false },
      { label: 'garanties', weight: 3, present: !!gtxt, verified: false },
      { label: 'promoteur', weight: 2, present: !!b.promoter, verified: false },
      { label: 'niveau de levier (LTV)', weight: 2, present: has(b.ltv), verified: false },
      { label: 'localisation', weight: 1, present: !!b.location },
      { label: 'comptes audités du porteur', weight: 2, present: false }
    ]);
    conf.reasons.unshift('données déclaratives non recoupées par une source indépendante');

    return { brick: b, score, components: comps, risks, notes, riskScore, ratio, confidence: conf };
  }

  function rankBricks() {
    const snap = G.Store.snapshot();
    const ctx = { snap, exp: exposures(snap) };
    const scored = G.Store.state.bricks.map(b => scoreBrick(b, ctx));
    scored.sort((a, b) => (b.score || 0) - (a.score || 0));
    return { ranked: scored, ctx };
  }

  /* ======================================================== RÉÉQUILIBRAGE */
  /** Règle 9 : privilégier le rééquilibrage par les versements, pas par les ventes. */
  function rebalance() {
    const snap = G.Store.snapshot();
    const st = G.Store.state;
    const monthly = Number(st.profile.monthlyBudget) || 0;
    const rows = ['etf', 'actions', 'crypto', 'immobilier'].map(k => {
      const actual = snap.alloc[k] || 0, target = snap.target[k] || 0;
      const gap = actual - target;
      const euroGap = snap.total * (gap / 100);
      return { key: k, label: { etf:'ETF', actions:'Actions', crypto:'Crypto', immobilier:'Immobilier' }[k],
               actual, target, gap, euroGap };
    });
    const maxGap = Math.max(...rows.map(r => Math.abs(r.gap)));
    let verdict, tone;
    if (snap.total <= 0) { verdict = 'Aucune position enregistrée : rien à rééquilibrer pour le moment.'; tone = 'c-info'; }
    else if (maxGap < 5) { verdict = 'Ton allocation est proche de ta cible. Aucun rééquilibrage nécessaire.'; tone = 'c-good'; }
    else if (maxGap < 12) { verdict = 'Léger écart à ta cible. Il n\'est pas nécessaire de vendre : oriente simplement tes prochains versements.'; tone = 'c-watch'; }
    else { verdict = 'Écart significatif à ta cible. Un redressement par les versements reste préférable ; une vente partielle ne se justifie que si l\'écart persiste plusieurs mois.'; tone = 'c-watch'; }

    // combien de mois de versements pour converger sans rien vendre
    const deficits = rows.filter(r => r.gap < 0);
    const totalDeficit = deficits.reduce((s, r) => s + Math.abs(r.euroGap), 0);
    const monthsToConverge = monthly > 0 && totalDeficit > 0 ? Math.ceil(totalDeficit / monthly) : null;

    // orientation recommandée des prochains versements
    const weights = {};
    if (totalDeficit > 0) {
      deficits.forEach(r => weights[r.key] = Math.abs(r.euroGap) / totalDeficit);
    } else {
      rows.forEach(r => weights[r.key] = (snap.target[r.key] || 0) / 100);
      const s = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
      Object.keys(weights).forEach(k => weights[k] /= s);
    }
    const nextContrib = Object.entries(weights)
      .map(([k, w]) => ({ key: k, label: rows.find(r => r.key === k).label, pct: w * 100, amount: monthly * w }))
      .filter(x => x.amount >= 1)
      .sort((a, b) => b.amount - a.amount);

    // vente seulement si dépassement vraiment marqué
    const sellCandidates = rows.filter(r => r.gap > 15)
      .map(r => ({ label: r.label, excess: r.euroGap,
        note: `${r.label} dépasse la cible de ${r.gap.toFixed(1)} points (${fmtE(r.euroGap)}). Une vente partielle est envisageable, mais compare d'abord au coût fiscal et aux frais : rediriger les versements est souvent suffisant.` }));

    return { rows, verdict, tone, maxGap, monthsToConverge, nextContrib, sellCandidates, snap, monthly };
  }

  /* ============================================================ MON PLAN */
  /** Règle 8 : montants dynamiques, dépendant du portefeuille réel. */
  async function buildPlan(input) {
    const st = G.Store.state;
    const capital = has(input.capital) ? input.capital : (Number(st.profile.availableCash) || 0);
    const monthly = has(input.monthly) ? input.monthly : (Number(st.profile.monthlyBudget) || 0);
    const horizon = input.horizon || st.profile.horizonYears || 10;
    const profKey = input.profile || st.profile.riskProfile || 'equilibre';
    const prof = D().PROFILES[profKey] || D().PROFILES.equilibre;

    const snap = G.Store.snapshot();
    const exp = exposures(snap);
    const ctx = { snap, exp };
    const analysis = analysePortfolio();

    /* Répartition par classe : on vise la cible en tenant compte de l'existant.
       Le déploiement corrige d'abord les poches en déficit.                   */
    const classes = ['etf', 'actions', 'crypto', 'immobilier'];
    const deficits = classes.map(k => {
      const targetEuro = (snap.total + capital) * (snap.target[k] || 0) / 100;
      const currentEuro = { etf: snap.etfValue, actions: snap.stockValue, crypto: snap.cryptoValue, immobilier: snap.bricksValue }[k];
      return { key: k, deficit: Math.max(0, targetEuro - currentEuro) };
    });
    const totalDef = deficits.reduce((s, d) => s + d.deficit, 0);

    function split(amount) {
      if (amount <= 0) return {};
      const out = {};
      if (totalDef > 0) {
        classes.forEach(k => {
          const d = deficits.find(x => x.key === k).deficit;
          out[k] = amount * (d / totalDef);
        });
      } else {
        const s = classes.reduce((a, k) => a + (snap.target[k] || 0), 0) || 1;
        classes.forEach(k => out[k] = amount * (snap.target[k] || 0) / s);
      }
      return out;
    }

    // Contraintes de bon sens : pas d'ordre trop petit (les frais fixes le rendent absurde)
    const MIN_ORDER = 50, MIN_BRICK = 10;
    function consolidate(bag, min) {
      const entries = Object.entries(bag).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      const kept = [], dropped = [];
      let pool = 0;
      entries.forEach(([k, v]) => { if (v >= min) kept.push([k, v]); else { pool += v; dropped.push(k); } });
      if (!kept.length && entries.length) { kept.push([entries[0][0], entries.reduce((s, e) => s + e[1], 0)]); pool = 0; }
      else if (pool > 0 && kept.length) kept[0][1] += pool;
      return { kept: Object.fromEntries(kept), dropped };
    }

    // Meilleurs supports pour chaque poche, calculés sur MON portefeuille
    const etfRank = await rankEtfs(null, 30);
    const bestEtfs = etfRank.ranked.filter(r => has(r.score)).slice(0, 4);

    const now = split(capital);
    const rec = split(monthly);
    const nowC = consolidate(now, MIN_ORDER);
    const recC = consolidate(rec, 25);

    function detailFor(classKey, amount, isMonthly) {
      const lines = [];
      if (amount <= 0) return lines;
      if (classKey === 'etf') {
        // La part principale va à un fonds capable de tenir le rôle de SOCLE
        // (large, mondial). Un satellite ne peut venir qu'en complément.
        const core = etfRank.ranked.find(r => has(r.score) && (r.cat.core || 0) >= 7) || bestEtfs[0];
        const picks = [];
        if (core) picks.push({ r: core, share: 1 });
        const compl = etfRank.ranked.find(r =>
          r !== core && has(r.score) && r.fit && has(r.fit.overlapGeo) && r.fit.overlapGeo < 60);
        if (compl && amount >= (isMonthly ? 60 : 150)) { picks[0].share = 0.7; picks.push({ r: compl, share: 0.3 }); }
        picks.forEach(p => {
          lines.push({
            amount: amount * p.share, label: p.r.cat.name, ticker: p.r.cat.ticker,
            kind: 'etf', score: p.r.score,
            why: reasonForEtf(p.r, isMonthly)
          });
        });
      } else if (classKey === 'actions') {
        const sleeve = snap.alloc.actions || 0;
        if (sleeve >= prof.maxStockSleeve) {
          lines.push({ amount, label: 'Poche actions déjà au plafond → reporté sur les ETF', kind: 'note',
            why: `Ta poche d'actions en direct atteint ${sleeve.toFixed(1)} %, au plafond de ${prof.maxStockSleeve} % de ton profil. Je préfère ne pas l'alimenter.` });
        } else {
          lines.push({ amount, label: 'Actions en direct — à sélectionner', kind: 'stock',
            why: 'Montant réservé à la poche actions. Utilise « Meilleures opportunités » pour choisir sur données réelles : je ne propose pas de titre sans avoir analysé ses fondamentaux du moment.' });
        }
      } else if (classKey === 'crypto') {
        const sleeve = snap.alloc.crypto || 0;
        const maxSleeve = prof.maxCryptoSleeve || 15;
        if (sleeve >= maxSleeve) {
          lines.push({ amount, label: 'Poche crypto déjà au plafond → reportée sur les ETF', kind: 'note',
            why: `Ta poche crypto atteint ${sleeve.toFixed(1)} %, au plafond de ${maxSleeve} % de ton profil. Je préfère ne pas l'alimenter.` });
        } else {
          // Règle 3 : aucune prédiction, aucun jeton nommé « qui va monter ».
          const detenus = snap.holdings.filter(h => h.type === 'crypto');
          const grosses = detenus.filter(h => (G.Store.cryptoMeta(h.ticker) || {}).cap === 'large');
          lines.push({
            amount, label: 'Cryptoactifs — à répartir toi-même', kind: 'crypto',
            why: 'Montant réservé à ta poche crypto. Je ne désigne aucun jeton : ' +
                 'aucun cryptoactif n\'a de flux financier permettant de le valoriser, ' +
                 'donc aucun score comparable à celui d\'un ETF ou d\'une action ne serait honnête. ' +
                 (grosses.length
                   ? `Tu détiens déjà ${grosses.map(h => h.ticker).join(', ')} : renforcer l'existant évite d'ajouter des lignes que tu ne suivras pas.`
                   : 'Sur cette poche, les grandes capitalisations sont les seules dont l\'historique de prix est assez long pour mesurer un risque.') +
                 ' Rappel : volatilité très élevée, aucun revenu, perte totale possible.'
          });
        }
      } else if (classKey === 'immobilier') {
        const b = rankBricks().ranked.filter(x => x.brick.status === 'candidat')[0];
        lines.push({
          amount, label: b ? b.brick.name : 'Immobilier participatif (Bricks)', kind: 'immo',
          score: b ? b.score : null,
          why: b ? `Projet le mieux noté de ta liste (${b.score}/100) sur le rapport rendement/risque, pas sur le seul rendement annoncé. Rendement non garanti, capital à risque.`
                 : 'Aucun projet candidat enregistré. Saisis les projets qui t\'intéressent dans le module Immobilier pour que je puisse les classer. Rappel : rendement non garanti, capital à risque.'
        });
      }
      return lines;
    }

    const thisMonth = [], recurring = [];
    Object.entries(nowC.kept).forEach(([k, v]) => detailFor(k, v, false).forEach(l => thisMonth.push(l)));
    Object.entries(recC.kept).forEach(([k, v]) => detailFor(k, v, true).forEach(l => recurring.push(l)));
    thisMonth.sort((a, b) => b.amount - a.amount);
    recurring.sort((a, b) => b.amount - a.amount);

    const proj = simulate({
      initial: snap.total + capital, monthly, years: horizon,
      rate: prof.hypotheses.central, vol: prof.hypotheses.vol, profile: prof
    });

    const conf = confidence([
      { label: 'valorisation du portefeuille', weight: 3, present: snap.total > 0 && snap.holdings.every(h => h._live) },
      { label: 'composition (look-through)', weight: 2, present: exp.coverage > 70, verified: false },
      { label: 'fiches ETF', weight: 2, present: bestEtfs.length > 0, verified: false },
      { label: 'historique de prix des supports', weight: 2, present: bestEtfs.some(e => !e.missingSeries) },
      { label: 'paramètres du plan', weight: 1, present: monthly > 0 || capital > 0 }
    ]);

    const notes = [];
    if (nowC.dropped.length) notes.push(`Les montants inférieurs à ${MIN_ORDER} € ont été regroupés : passer un ordre trop petit fait exploser le poids des frais fixes.`);
    if (capital <= 0 && monthly <= 0) notes.push('Aucun montant saisi : renseigne un capital disponible ou un versement mensuel.');
    if (capital > 0 && capital > monthly * 6) notes.push(`Tu déploies ${fmtE(capital)} d'un coup. Un étalement sur 3 à 6 mois réduit le risque de mal choisir ton point d'entrée.`);

    return { capital, monthly, horizon, prof, thisMonth, recurring, analysis, proj, confidence: conf, notes, snap, bestEtfs };
  }

  function reasonForEtf(r, isMonthly) {
    const c = r.cat, bits = [];
    if (has(c.ter)) bits.push(`frais de ${c.ter} %/an`);
    if (has(c.holdings)) bits.push(`${c.holdings.toLocaleString('fr-FR')} lignes`);
    if (c.pea) bits.push('éligible PEA');
    let s = `${c.index} — ${bits.join(', ')}.`;
    if (r.fit && r.fit.reasons && r.fit.reasons.length) s += ' ' + r.fit.reasons[0];
    if (r.stats && has(r.stats.vol)) s += ` Volatilité mesurée : ${r.stats.vol.toFixed(1)} %/an (${r.stats.source}).`;
    else s += ' Historique de prix non disponible : le score repose sur les caractéristiques structurelles.';
    return s;
  }

  /* =========================================================== SIMULATEUR */
  /** Règle 10 : trois scénarios + distribution Monte-Carlo, présentés comme
   *  des hypothèses, jamais comme des prévisions. */
  function simulate(p) {
    const years = Math.max(1, p.years || 10);
    const months = Math.round(years * 12);
    const initial = Number(p.initial) || 0;
    const monthly = Number(p.monthly) || 0;
    const prof = p.profile || D().PROFILES.equilibre;
    const central = has(p.rate) ? p.rate : prof.hypotheses.central;
    const vol = has(p.vol) ? p.vol : prof.hypotheses.vol;
    const pess = has(p.pess) ? p.pess : Math.min(central - 3.5, prof.hypotheses.pess);
    const opti = has(p.opti) ? p.opti : Math.max(central + 3, prof.hypotheses.opti);

    function path(annual) {
      const r = Math.pow(1 + annual / 100, 1 / 12) - 1;
      let v = initial; const pts = [{ m: 0, v, paid: initial }];
      let paid = initial;
      for (let m = 1; m <= months; m++) {
        v = v * (1 + r) + monthly; paid += monthly;
        if (m % 3 === 0 || m === months) pts.push({ m, v, paid });
      }
      return { final: v, paid, points: pts };
    }
    const sc = { pess: path(pess), central: path(central), opti: path(opti) };

    /* Monte-Carlo : 1 500 trajectoires, rendements mensuels normaux.
       Donne des percentiles au lieu de trois chiffres arbitraires.        */
    const N = 1500, finals = [];
    const mu = Math.pow(1 + central / 100, 1 / 12) - 1;
    const sd = (vol / 100) / Math.sqrt(12);
    let seed = 20260823;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const gauss = () => { const u = Math.max(rnd(), 1e-9), v2 = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v2); };
    for (let i = 0; i < N; i++) {
      let v = initial;
      for (let m = 0; m < months; m++) { v = v * (1 + mu + sd * gauss()); v += monthly; if (v < 0) v = 0; }
      finals.push(v);
    }
    finals.sort((a, b) => a - b);
    const pc = q => finals[Math.min(finals.length - 1, Math.floor(q * finals.length))];
    const paid = initial + monthly * months;
    const mc = {
      p10: pc(.10), p25: pc(.25), p50: pc(.50), p75: pc(.75), p90: pc(.90),
      lossProb: finals.filter(x => x < paid).length / finals.length * 100, paid, runs: N
    };

    return {
      years, months, initial, monthly, paid, rates: { pess, central, opti, vol },
      scenarios: sc, mc, profile: prof,
      disclaimer: 'Ces montants sont des hypothèses de calcul, pas des prévisions. Les rendements passés ne préjugent pas des rendements futurs et le capital peut baisser.'
    };
  }

  /* ================================================ MEILLEURES OPPORTUNITÉS */
  /** Règle 6 + 14 : shortlist sur le rapport qualité/risque/valorisation/
   *  adéquation, jamais sur « ce qui va exploser ». */
  async function findOpportunities(onProgress) {
    const snap = G.Store.snapshot();
    const exp = exposures(snap);
    const ctx = { snap, exp };
    const out = [];
    const notes = [];

    // --- ETF
    const etfs = await rankEtfs(null, 40);
    etfs.ranked.forEach(r => {
      if (!has(r.score)) return;
      out.push({
        kind: 'etf', id: r.cat.id, name: r.cat.name, ticker: r.cat.ticker, score: r.score,
        confidence: r.confidence, detail: r, why: whyEtf(r)
      });
    });

    // --- Actions : univers + watchlist + lignes détenues
    const tickers = new Set();
    D().STOCK_UNIVERSE.forEach(u => tickers.add(u.t));
    G.Store.state.watchlist.forEach(w => tickers.add(w.ticker));
    snap.holdings.filter(h => h.type === 'action' && h.ticker).forEach(h => tickers.add(h.ticker));

    if (!G.Market.hasProvider()) {
      notes.push("Aucun fournisseur de données n'est configuré : je ne peux pas analyser d'action sans fondamentaux réels. Renseigne une clé gratuite dans Réglages — je ne remplirai pas ce vide par des chiffres inventés.");
    } else {
      const list = Array.from(tickers);
      let i = 0;
      for (const t of list) {
        i++;
        if (onProgress) onProgress(i, list.length, t);
        try {
          const s = await scoreStock(t, { snap, exp });
          if (s.noData || !has(s.score)) continue;
          out.push({
            kind: 'action', id: t, name: s.name, ticker: s.ticker, score: s.score,
            confidence: s.confidence, detail: s, why: whyStock(s)
          });
        } catch (e) { /* titre ignoré */ }
      }
    }

    // --- Immobilier : projets candidats saisis
    rankBricks().ranked.filter(b => b.brick.status === 'candidat').forEach(b => {
      out.push({
        kind: 'immo', id: b.brick.id, name: b.brick.name, score: b.score,
        confidence: b.confidence, detail: b, why: whyBrick(b)
      });
    });

    // Filtre de qualité : on n'affiche pas ce dont on n'est pas assez sûr (règle 15)
    const shortlisted = out
      .filter(o => o.confidence && o.confidence.score >= 40)
      .sort((a, b) => b.score - a.score);
    const excluded = out.filter(o => !(o.confidence && o.confidence.score >= 40));
    if (excluded.length) notes.push(`${excluded.length} candidat(s) écarté(s) faute de données suffisantes pour conclure honnêtement.`);

    return { list: shortlisted.slice(0, 12), all: out, notes, ctx };
  }

  function whyEtf(r) {
    const c = r.cat, why = [];
    const comp = k => r.components.find(x => x.k === k);
    const f = comp('Frais'), d = comp('Diversification'), fit = comp('Apport portefeuille'), rr = comp('Rendement/risque');
    if (f && has(f.v) && f.v >= 7) why.push(`Frais bas (${c.ter} %/an) : sur ${G.Store.state.profile.horizonYears} ans, c'est l'un des rares paramètres réellement sous ton contrôle.`);
    if (d && has(d.v) && d.v >= 7) why.push(`Diversification élevée${has(c.holdings) ? ` (${c.holdings.toLocaleString('fr-FR')} lignes)` : ''} sur ${c.index}.`);
    if (rr && has(rr.v) && rr.v >= 6.5 && r.stats) why.push(`Rapport rendement/risque correct sur ${r.stats.years.toFixed(1)} ans mesurés : volatilité ${r.stats.vol.toFixed(1)} %, pire baisse ${r.stats.maxDD.toFixed(1)} %.`);
    if (fit && has(fit.v) && fit.v >= 7) why.push(r.fit.reasons[0] || 'Apporte une exposition que tu n\'as pas encore.');
    if (c.pea) why.push('Éligible PEA : avantage fiscal après 5 ans de détention du plan.');
    if (!why.length) why.push('Profil correct sans point fort marqué : à considérer comme un complément, pas comme une priorité.');
    return why;
  }
  function whyStock(s) {
    const why = [];
    const g = s.subs;
    // On n'invoque la « qualité » que si une donnée comptable la soutient :
    // un score porté par la seule stabilité du cours ne la démontre pas.
    if (has(g.qualite) && g.qualite >= 7) {
      const f = s.fundamentals, b = [];
      if (has(f.grossMargin)) b.push(`marge brute ${f.grossMargin.toFixed(1)} %`);
      if (has(f.roe)) b.push(`rentabilité des capitaux propres ${f.roe.toFixed(1)} %`);
      if (has(f.operMargin)) b.push(`marge opérationnelle ${f.operMargin.toFixed(1)} %`);
      if (b.length) why.push(`Qualité élevée (${b.join(', ')}).`);
    }
    if (has(g.valorisation) && g.valorisation >= 6.5) why.push(`Valorisation raisonnable${has(s.fundamentals.pe) ? ` (PER ${s.fundamentals.pe.toFixed(1)})` : ''} au regard de ses fondamentaux.`);
    if (has(g.croissance) && g.croissance >= 7) why.push(`Croissance soutenue${has(s.fundamentals.revenueGrowth) ? ` (chiffre d'affaires ${s.fundamentals.revenueGrowth.toFixed(1)} % sur un an)` : ''}.`);
    if (has(g.dette) && g.dette >= 7) why.push('Structure financière solide, endettement contenu.');
    if (s.fit >= 7) why.push(s.fitReasons[0] || 'Complète bien ton allocation actuelle.');
    if (has(s.pos52) && s.pos52 < 40) why.push(`Cours dans le bas de son canal 12 mois (${s.pos52.toFixed(0)} %) — un point d'entrée moins tendu, ce qui ne dit rien de la suite.`);
    if (!why.length) why.push('Aucun point fort décisif : présente dans la liste par son score global, sans conviction particulière.');
    return why;
  }
  function whyBrick(b) {
    const why = [];
    const g = k => b.components.find(x => x.k === k);
    if (g('Garanties') && g('Garanties').v >= 7) why.push('Garanties solides pour ce type de projet.');
    if (g('Rendement') && g('Rendement').v >= 6) why.push(`Rendement annoncé de ${b.brick.yieldPct} % — non garanti.`);
    if (has(b.ratio)) why.push(`Rapport rendement/risque parmi les meilleurs de ta liste, sans se limiter au taux affiché.`);
    if (g('Durée / liquidité') && g('Durée / liquidité').v >= 6) why.push(`Durée d'immobilisation contenue (${b.brick.durationMonths} mois).`);
    if (!why.length) why.push('Classement fondé sur l\'équilibre garanties / promoteur / durée, pas sur le rendement affiché.');
    return why;
  }

  /* ==================================================== JOURNAL — RELECTURE */
  /** Règle 12 : mesurer la qualité réelle des analyses passées. */
  async function reviewJournal() {
    const entries = G.Store.state.journal;
    if (!entries.length) return { entries: [], summary: 'Aucune analyse enregistrée pour le moment.', stats: null };

    const reviewed = [];
    for (const e of entries) {
      let now = null;
      if (e.ticker || e.asset) {
        try { now = await G.Market.quote(e.ticker || e.asset); } catch (err) { /* rien */ }
      }
      const ageDays = Math.round((Date.now() - new Date(e.date).getTime()) / 86400e3);
      let change = null;
      if (now && has(e.priceAtAnalysis) && e.priceAtAnalysis > 0) change = (now.price / e.priceAtAnalysis - 1) * 100;
      reviewed.push(Object.assign({}, e, { _now: now, _change: change, _ageDays: ageDays }));
    }

    const mature = reviewed.filter(r => r._ageDays >= 90 && has(r._change));
    let stats = null;
    if (mature.length) {
      const positive = mature.filter(r => (r.recommendation || '').match(/int[ée]ressant|acheter|renforcer/i));
      const negative = mature.filter(r => (r.recommendation || '').match(/attendre|cher|risque|[ée]viter|pas adapt/i));
      const avgPos = positive.length ? positive.reduce((s, r) => s + r._change, 0) / positive.length : null;
      const avgNeg = negative.length ? negative.reduce((s, r) => s + r._change, 0) / negative.length : null;
      stats = {
        total: mature.length, positive: positive.length, negative: negative.length,
        avgPos, avgNeg,
        discrimination: (has(avgPos) && has(avgNeg)) ? avgPos - avgNeg : null,
        avgConfidence: mature.reduce((s, r) => s + (r.confidence || 0), 0) / mature.length,
        hitRate: positive.length ? positive.filter(r => r._change > 0).length / positive.length * 100 : null
      };
    }

    let summary;
    if (!mature.length) {
      summary = `${reviewed.length} analyse(s) enregistrée(s), mais aucune n'a encore 3 mois. Il est trop tôt pour juger : évaluer une décision d'investissement long terme sur quelques semaines n'a pas de sens.`;
    } else {
      const d = stats.discrimination;
      if (!has(d)) summary = `${mature.length} analyse(s) d'au moins 3 mois. Pas encore assez d'avis contrastés (positifs ET négatifs) pour mesurer si mes analyses discriminent réellement.`;
      else if (d > 5) summary = `Sur ${mature.length} analyses d'au moins 3 mois, les actifs que j'ai jugés intéressants ont progressé de ${d.toFixed(1)} points de plus que ceux sur lesquels j'ai émis des réserves. Le raisonnement a discriminé — sur un échantillon encore réduit.`;
      else if (d < -5) summary = `Sur ${mature.length} analyses, mes avis favorables ont fait ${Math.abs(d).toFixed(1)} points de MOINS que mes avis réservés. Sur cette période, mon raisonnement a été contre-productif : à prendre au sérieux plutôt qu'à excuser.`;
      else summary = `Sur ${mature.length} analyses d'au moins 3 mois, l'écart entre mes avis favorables et réservés est de ${d.toFixed(1)} points : trop faible pour affirmer que mes analyses apportent quelque chose. Un échantillon de cette taille ne permet pas de conclure.`;
    }
    return { entries: reviewed, summary, stats };
  }

  /* ------------------------------------------------------------- utilitaire */
  function fmtE(v) {
    if (!has(v)) return '—';
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
  }

  G.Engine = {
    confidence, exposures, analysePortfolio, scoreEtf, rankEtfs, scoreStock,
    scoreBrick, rankBricks, rebalance, buildPlan, simulate, findOpportunities,
    reviewJournal, fitScore, scale, avg, has, fmtE
  };
})(window);
