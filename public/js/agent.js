/* ============================================================================
   agent.js — InvestAI
   Deux modes, mêmes chiffres :
   · LOCAL (gratuit, hors-ligne) : détection d'intention + réponses construites
     par le moteur d'analyse.
   · ÉTENDU (clé Anthropic facultative) : le même contexte et les mêmes calculs
     sont transmis à Claude pour une conversation en langage naturel complet.
     Les chiffres restent produits par engine.js — le modèle ne les invente pas.
   ========================================================================== */
(function (G) {
  'use strict';
  const E = () => G.Engine;
  const has = v => v !== null && v !== undefined && isFinite(v);
  const eur = v => E().fmtE(v);
  const pct = (v, d) => has(v) ? (v >= 0 ? '+' : '') + v.toFixed(d === undefined ? 1 : d) + ' %' : '—';
  const pctA = (v, d) => has(v) ? v.toFixed(d === undefined ? 1 : d) + ' %' : '—';

  /* ===================================================== EXTRACTION D'ENTITÉS */
  function extract(text) {
    const t = text.toLowerCase().replace(/ /g, ' ');
    const out = { amounts: [], years: null, months: null, tickers: [], monthly: null };

    // montants : « 300 € », « 1 000 euros », « 1000e »
    const re = /(\d[\d\s.,]*)\s*(?:€|eur\b|euros?\b|e\b)/g;
    let m;
    while ((m = re.exec(t))) {
      const n = parseFloat(m[1].replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
      if (isFinite(n) && n > 0) out.amounts.push(n);
    }
    if (!out.amounts.length) {
      const re2 = /\b(\d{2,7})\b/g;
      while ((m = re2.exec(t))) { const n = parseInt(m[1], 10); if (n >= 20 && n <= 5000000) out.amounts.push(n); }
    }
    // récurrence mensuelle
    if (/(par|chaque|tous les|\/)\s*mois|mensuel/.test(t) && out.amounts.length) out.monthly = out.amounts[0];

    const ym = t.match(/(\d{1,2})\s*(?:ans?|années?)/);
    if (ym) out.years = parseInt(ym[1], 10);
    const mm = t.match(/(\d{1,3})\s*mois/);
    if (mm && !/tous les mois|par mois|chaque mois/.test(t)) out.months = parseInt(mm[1], 10);

    // tickers connus + noms d'entreprises
    const uni = G.DATA.STOCK_UNIVERSE;
    uni.forEach(u => {
      const nm = u.n.toLowerCase().replace(/['’]/g, "'");
      if (t.includes(nm) || new RegExp('\\b' + u.t.toLowerCase().replace('.', '\\.') + '\\b').test(t)) out.tickers.push(u.t);
    });
    G.Store.state.watchlist.forEach(w => {
      if (new RegExp('\\b' + w.ticker.toLowerCase() + '\\b').test(t)) out.tickers.push(w.ticker);
    });
    G.Store.state.holdings.forEach(h => {
      if (h.ticker && new RegExp('\\b' + h.ticker.toLowerCase() + '\\b').test(t)) out.tickers.push(h.ticker);
    });
    // tickers en majuscules dans le texte original
    (text.match(/\b[A-Z]{2,5}(?:\.[A-Z]{1,2})?\b/g) || []).forEach(x => {
      if (!['ETF', 'PEA', 'CTO', 'IA', 'PER', 'PEG', 'USD', 'EUR', 'SCPI'].includes(x)) out.tickers.push(x);
    });
    out.tickers = Array.from(new Set(out.tickers));
    return out;
  }

  /* ================================================== DÉTECTION D'INTENTION */
  const INTENTS = [
    { id:'rebalance',   p:[/r[ée][ée]?quilibr/, /dois[- ]je\s+r[ée]/, /allocation\s+cible/] },
    { id:'diversif',    p:[/diversifi/, /suffisamment\s+divers/, /assez\s+divers/] },
    { id:'analyse',     p:[/analyse\s+(mon|le)\s+portefeuille/, /analyser\s+mon\s+portefeuille/, /comment\s+va\s+mon\s+portefeuille/, /[ée]tat\s+de\s+mon\s+portefeuille/] },
    { id:'plan',        p:[/meilleur\s+plan/, /plan\s+d[''investissement]/, /tous\s+les\s+mois\s+pendant/, /si\s+j['']investis.*pendant/, /strat[ée]gie\s+sur\s+\d+\s*ans/] },
    { id:'simulate',    p:[/simul/, /combien.*dans\s+\d+\s*ans/, /projection/, /que\s+vaudrait/, /mon\s+patrimoine\s+dans/] },
    { id:'invest',      p:[/[àa]\s+investir/, /disponibles?\b/, /o[ùu]\s+investir/, /que\s+ferais[- ]tu/, /qu['']est[- ]ce\s+qui\s+serait/, /prochains?\s+\d+/, /j['']ai\s+\d+.*(€|euros?)/, /investir\s+ce\s+mois/, /quoi\s+acheter/] },
    { id:'compare',     p:[/compare[rz]?\b/, /versus\b/, /\bvs\b/, /diff[ée]rence\s+entre/] },
    { id:'etfWorld',    p:[/etf\s+monde/, /msci\s+world/, /all[- ]world/, /etf\s+mondial/] },
    { id:'bestEtf',     p:[/meilleurs?\s+etf/, /etf.*(int[ée]ressants?|pour\s+mon\s+profil)/, /quel\s+etf/, /trouve.*etf/] },
    { id:'bestStocks',  p:[/meilleures?\s+actions/, /actions?\s+int[ée]ressantes?/, /trouve.*actions?/, /quelles?\s+actions?/] },
    { id:'expensive',   p:[/trop\s+ch[èe]re?/, /est[- ]elle\s+ch[èe]re/, /valorisation\s+de/, /surcot[ée]/, /ch[èe]re?\s*\?/] },
    { id:'buyNow',      p:[/acheter\s+maintenant/, /attendre/, /bon\s+moment/, /point\s+d['']entr[ée]e/, /maintenant\s+ou/] },
    { id:'bricks',      p:[/bricks/, /immobilier\s+participatif/, /projets?\s+immobiliers?/, /crowdfunding/] },
    { id:'etfVsBricks', p:[/etf.*(et|vs|versus|ou)\s*bricks/, /bricks.*(et|vs|versus|ou)\s*etf/, /etf.*immobilier/] },
    { id:'opportunities',p:[/opportunit/, /meilleures?\s+opportunit/, /que\s+m['']?as[- ]tu\s+trouv/] },
    { id:'journal',     p:[/journal/, /analyses?\s+[ée]taient?\s+correctes?/, /historique\s+de\s+mes\s+d[ée]cisions/, /mes\s+d[ée]cisions/] },
    { id:'stock',       p:[/analyse[rz]?\s+[A-Za-z.]{2,6}\s*$/, /que\s+penses[- ]tu\s+de/, /fondamentaux/] },
    { id:'help',        p:[/aide/, /que\s+sais[- ]tu\s+faire/, /comment\s+[çc]a\s+marche/, /^\s*(bonjour|salut|hello|coucou)\b/] }
  ];

  /* Quelques formulations sont ambiguës pour un simple comptage de motifs
     (« compare ETF et Bricks » déclenche à la fois compare, bricks et etfVsBricks).
     Ces règles prioritaires tranchent avant le comptage.                        */
  const PRIORITY = [
    { id:'etfVsBricks', re:/(etf|bourse).{0,25}(bricks|immobilier)|(bricks|immobilier).{0,25}(etf|bourse)/ },
    { id:'etfWorld',    re:/etf\s+(monde|mondial)|msci\s+world|all[- ]world/ },
    { id:'plan',        re:/meilleur\s+plan|tous\s+les\s+mois\s+pendant|chaque\s+mois\s+pendant/ },
    { id:'journal',     re:/analyses?\s+[ée]taient?\s+correctes?/ },
    { id:'rebalance',   re:/r[ée][ée]?quilibr/ }
  ];

  function detect(text) {
    const t = text.toLowerCase();
    for (const p of PRIORITY) if (p.re.test(t)) return p.id;
    const scores = INTENTS.map(i => ({ id: i.id, n: i.p.filter(re => re.test(t)).length }));
    scores.sort((a, b) => b.n - a.n);
    if (scores[0].n === 0) return null;
    return scores[0].id;
  }

  /* ============================================== CONSTRUCTION DES RÉPONSES */

  function header(title) { return `#### ${title}\n`; }

  function confLine(c) {
    if (!c) return '';
    return `\n<div class="confidence"><span class="conf-txt">Confiance : <b>${c.score}/100</b></span>` +
      `<span class="conf-bar"><i style="width:${c.score}%;background:${c.score >= 70 ? 'var(--pos)' : c.score >= 45 ? 'var(--warn)' : 'var(--neg)'}"></i></span>` +
      `<span class="conf-txt">${c.reasons[0]}</span></div>`;
  }
  function sourceLine(list) {
    if (!list || !list.length) return '';
    return `<div class="sources">` + list.map(s =>
      `<span>· ${s.what} : <b>${s.src}</b>${s.asOf ? ' — ' + s.asOf : ''}</span>`).join('') + `</div>`;
  }

  /* ---------------------------------------------------- Analyse portefeuille */
  function respAnalyse() {
    const a = E().analysePortfolio();
    const s = a.snap;
    if (s.total <= 0) {
      return `Ton portefeuille est vide pour l'instant : je n'ai rien à analyser.\n\n` +
        `Ajoute tes positions réelles dans **Portefeuille** (ETF, actions), tes projets dans **Immobilier** et tes liquidités. ` +
        `Je ne peux pas te proposer d'investissement sans savoir ce que tu détiens déjà — c'est la règle que tu m'as fixée, et elle est saine.`;
    }
    let o = header('Analyse de ton portefeuille');
    o += `<div class="kv">
      <div><span class="k">Patrimoine total</span><span class="v">${eur(s.total)}</span></div>
      <div><span class="k">Diversification</span><span class="v">${a.divScore}/100</span></div>
      <div><span class="k">Risque</span><span class="v">${a.riskLabel}${has(a.portVol) ? ' (' + a.portVol.toFixed(1) + ' %/an)' : ''}</span></div>
      <div><span class="k">Concentration</span><span class="v">${a.concentrationLabel}</span></div>
      <div><span class="k">Expositions effectives</span><span class="v">${a.effectiveLines.toFixed(0)}</span></div>
      <div><span class="k">Titres sous-jacents</span><span class="v">${a.underlying.toLocaleString('fr-FR')}</span></div>
    </div>`;

    const geo = a.exp.geo.slice(0, 6).filter(g => g.pct > 0.5);
    if (geo.length) {
      o += `\n**Exposition géographique**\n\n`;
      o += geo.map(g => `- ${g.key} : ${pctA(g.pct)}`).join('\n') + '\n';
    }
    const sec = a.exp.sector.slice(0, 7).filter(g => g.pct > 0.5);
    if (sec.length) {
      o += `\n**Exposition sectorielle**\n\n`;
      o += sec.map(g => `- ${g.key} : ${pctA(g.pct)}`).join('\n') + '\n';
    }
    if (a.exp.coverage < 100) {
      o += `\n<span class="muted sm">Composition connue sur ${a.exp.coverage.toFixed(0)} % du portefeuille. Le reste n'est pas décomposé — je ne comble pas ce trou par des estimations.</span>\n`;
    }

    o += `\n**Ce que je changerais**\n\n`;
    const top = a.issues.slice(0, 3);
    if (!top.length) o += `Rien de significatif. Ton allocation est cohérente avec ton profil ${s.profile.label.toLowerCase()} et ton horizon de ${G.Store.state.profile.horizonYears} ans. Le meilleur geste, à ce stade, est de ne rien faire de spécial et de continuer tes versements.\n`;
    else o += top.map((i, n) => `${n + 1}. **${i.title}** — ${i.detail} → *${i.action}*`).join('\n') + '\n';

    o += confLine(a.confidence);
    return o;
  }

  /* --------------------------------------------------------- Diversification */
  function respDiversif() {
    const a = E().analysePortfolio();
    if (a.snap.total <= 0) return respAnalyse();
    let o = header('Est-ce que tu es suffisamment diversifié ?');
    const d = a.divScore;
    const verdict = d >= 75 ? 'Oui, globalement.' : d >= 55 ? 'Partiellement.' : 'Non, pas encore.';
    o += `**${verdict}** Score de diversification : **${d}/100**.\n\n`;
    o += `Le détail, dimension par dimension :\n\n`;
    const lbl = { lignes: 'Équilibre en transparence', geographie: 'Dispersion géographique', secteurs: 'Dispersion sectorielle', profondeur: 'Nombre de titres sous-jacents', classes: 'Classes d\'actifs' };
    o += Object.entries(a.breakdown).filter(([, v]) => has(v))
      .map(([k, v]) => `- ${lbl[k]} : **${v.toFixed(1)}/10**`).join('\n') + '\n';

    o += `\nConcrètement, une fois tes ETF décomposés, ton portefeuille se comporte comme s'il comptait **${a.effectiveLines.toFixed(0)} expositions équivalentes** ` +
      `réparties sur **${a.underlying.toLocaleString('fr-FR')} titres sous-jacents**.\n`;

    const g = a.exp.geo.filter(x => x.key !== 'Non renseigné')[0];
    const sc = a.exp.sector.filter(x => x.key !== 'Non renseigné')[0];
    if (g) o += `\nTa première zone, ${g.key}, pèse ${pctA(g.pct)}${g.pct > 70 ? " — c'est beaucoup, et c'est le point que je surveillerais en premier." : '.'}\n`;
    if (sc) o += `Ton premier secteur, ${sc.key}, pèse ${pctA(sc.pct)}${sc.pct > a.snap.profile.maxSectorExposure ? ` — au-delà de ta limite de ${a.snap.profile.maxSectorExposure} %.` : '.'}\n`;

    const acts = a.issues.filter(i => /Concentration|Surexposition|zone|lignes effectives/.test(i.title)).slice(0, 3);
    if (acts.length) {
      o += `\n**Pour améliorer**\n\n` + acts.map((i, n) => `${n + 1}. ${i.action}`).join('\n') + '\n';
    } else {
      o += `\nJe ne vois pas de correctif urgent. Ajouter des lignes pour ajouter des lignes dégraderait ta lisibilité sans réduire ton risque.\n`;
    }
    o += confLine(a.confidence);
    return o;
  }

  /* ------------------------------------------------------------ Rééquilibrage */
  function respRebalance() {
    const r = E().rebalance();
    let o = header('Dois-tu rééquilibrer ?');
    o += `<div class="conclusion ${r.tone}">${r.verdict}</div>\n\n`;
    o += `| Poche | Réel | Cible | Écart |\n|---|---|---|---|\n`;
    o += r.rows.map(x => `| ${x.label} | ${pctA(x.actual)} | ${x.target} % | ${x.gap >= 0 ? '+' : ''}${x.gap.toFixed(1)} pts |`).join('\n') + '\n';

    if (r.nextContrib.length && r.monthly > 0) {
      o += `\n**Orientation de tes prochains versements (${eur(r.monthly)}/mois)**\n\n`;
      o += r.nextContrib.map(c => `- ${c.label} : **${eur(c.amount)}** (${pctA(c.pct, 0)})`).join('\n') + '\n';
    }
    if (r.monthsToConverge) {
      o += `\nÀ ce rythme, tu reviens sur ta cible en **environ ${r.monthsToConverge} mois** sans vendre quoi que ce soit.\n`;
    }
    if (r.sellCandidates.length) {
      o += `\n**Vente éventuelle**\n\n` + r.sellCandidates.map(s => `- ${s.note}`).join('\n') + '\n';
    } else if (r.maxGap >= 5) {
      o += `\nJe ne recommande **aucune vente** : rediriger les versements coûte zéro frais et zéro impôt, là où vendre déclenche les deux.\n`;
    }
    return o;
  }

  /* ------------------------------------------------ Où investir un montant */
  async function respInvest(ent) {
    const amount = ent.amounts.length ? Math.max(...ent.amounts) : (Number(G.Store.state.profile.monthlyBudget) || 0);
    if (!amount) {
      return `Dis-moi quel montant tu veux placer, par exemple « **j'ai 300 € à investir ce mois-ci** », et je regarde ton portefeuille avant de proposer quoi que ce soit.`;
    }
    const plan = await E().buildPlan({ capital: amount, monthly: 0 });
    const a = plan.analysis;
    const s = plan.snap;

    let o = header(`Où placer ${eur(amount)} ?`);
    o += `J'ai d'abord regardé ce que tu détiens : **${eur(s.total)}** au total, ` +
      `réparti en ${pctA(s.alloc.etf)} ETF · ${pctA(s.alloc.actions)} actions · ${pctA(s.alloc.crypto)} crypto · ${pctA(s.alloc.immobilier)} immobilier. ` +
      `Ta cible est ${s.target.etf}/${s.target.actions}/${s.target.crypto}/${s.target.immobilier}.\n\n`;

    if (!plan.thisMonth.length) {
      o += `Je n'ai pas de répartition à proposer : aucun support n'est exploitable avec les données dont je dispose.\n`;
      return o + confLine(plan.confidence);
    }

    o += `**Ma proposition**\n\n`;
    plan.thisMonth.forEach(l => {
      o += `- **${eur(l.amount)} → ${l.label}**${l.ticker ? ` (${l.ticker})` : ''}${has(l.score) ? ` · score ${l.score}/100` : ''}\n  <span class="muted sm">${l.why}</span>\n`;
    });

    const issue = a.issues[0];
    if (issue && issue.sev >= 2) {
      o += `\n**Ce qui a guidé ce choix**\n\n${issue.title} : ${issue.detail}\n`;
    }
    if (plan.notes.length) o += `\n` + plan.notes.map(n => `<span class="muted sm">· ${n}</span>`).join('<br>') + '\n';

    // Scénarios sur ce versement précis
    const sim = E().simulate({ initial: amount, monthly: 0, years: G.Store.state.profile.horizonYears, profile: s.profile });
    o += `\n**Ce que ce montant pourrait devenir sur ${sim.years} ans** *(hypothèses, pas des prévisions)*\n\n`;
    o += `- Scénario pessimiste (${pctA(sim.rates.pess)}/an) : ${eur(sim.scenarios.pess.final)}\n`;
    o += `- Scénario central (${pctA(sim.rates.central)}/an) : ${eur(sim.scenarios.central.final)}\n`;
    o += `- Scénario optimiste (${pctA(sim.rates.opti)}/an) : ${eur(sim.scenarios.opti.final)}\n`;

    o += `\n<span class="muted sm">La décision finale reste la tienne. Je peux enregistrer cette proposition dans ton journal pour qu'on la relise dans quelques mois.</span>`;
    o += confLine(plan.confidence);
    return o;
  }

  /* ------------------------------------------------------------ Meilleurs ETF */
  async function respBestEtf(filter, ent) {
    const { ranked, ctx } = await E().rankEtfs(filter, 3);
    if (!ranked.length) return `Aucun ETF dans le catalogue ne correspond à ce filtre.`;

    let o = header('ETF les plus intéressants pour toi');
    o += `<span class="muted sm">Classement pour un profil **${ctx.snap.profile.label.toLowerCase()}**, horizon ${G.Store.state.profile.horizonYears} ans. Le critère décisif n'est jamais la performance passée : les frais, la diversification et l'apport à ton portefeuille pèsent davantage.</span>\n\n`;

    ranked.forEach((r, i) => {
      const c = r.cat;
      o += `\n**${i + 1}. ${c.name}** — score **${r.score}/100**\n\n`;
      o += `<span class="muted sm">${c.index} · ${c.ticker} · ${c.isin}</span>\n\n`;
      o += `*Pourquoi il est intéressant*\n\n`;
      o += whyList(r).map(w => `- ${w}`).join('\n') + '\n';
      o += `\n*Frais* : ${has(c.ter) ? c.ter + ' %/an' : 'non renseignés'}`;
      o += ` · *Diversification* : ${has(c.holdings) ? c.holdings.toLocaleString('fr-FR') + ' lignes' : 'non renseignée'}`;
      o += ` · *Encours* : ${has(c.aum) ? '≈ ' + c.aum.toLocaleString('fr-FR') + ' M€' : 'non renseigné'}`;
      o += ` · *${c.dist}* · *${c.replication}*${c.pea ? ' · **PEA**' : ''}\n`;
      o += `\n*Risques* : ${riskLine(r)}\n`;
      o += `\n*Place dans ton portefeuille* : ${placeLine(r, ctx)}\n`;
      o += confLine(r.confidence);
      if (!c.verified) o += `<div class="sources"><span>· Fiche de référence saisie manuellement (${c.asOf}) — <b>vérifie le DIC de l'émetteur</b> avant d'acheter : frais et éligibilité PEA évoluent.</span></div>`;
    });
    return o;
  }
  function whyList(r) {
    const out = [];
    const c = r.cat;
    const g = k => r.components.find(x => x.k === k);
    if (has(c.ter)) out.push(`Frais de **${c.ter} %/an**${c.ter <= 0.2 ? ' — parmi les plus bas de sa catégorie' : c.ter >= 0.35 ? ' — plus élevés que la moyenne, à mettre en balance avec l\'accès PEA' : ''}.`);
    if (has(c.holdings)) out.push(`**${c.holdings.toLocaleString('fr-FR')} positions** répliquant ${c.index}.`);
    if (r.stats) out.push(`Sur **${r.stats.years.toFixed(1)} ans mesurés** : volatilité ${pctA(r.stats.vol)}/an, pire baisse ${pctA(r.stats.maxDD)}${has(r.stats.cagr) ? `, rendement annualisé ${pctA(r.stats.cagr)}` : ''} *(${r.stats.source}, ${r.stats.asOf})*.`);
    else out.push(`Historique de prix indisponible : le score repose uniquement sur les caractéristiques structurelles du fonds.`);
    if (r.fit && r.fit.reasons.length) out.push(r.fit.reasons[0]);
    if (c.note) out.push(c.note);
    return out;
  }
  function riskLine(r) {
    const c = r.cat, bits = [];
    if (/synth/i.test(c.replication)) bits.push('réplication synthétique — risque de contrepartie sur le swap');
    if (c.currency && c.currency !== 'EUR') bits.push(`fonds libellé en ${c.currency} : risque de change non couvert`);
    if (has(c.holdings) && c.holdings < 120) bits.push(`seulement ${c.holdings} lignes — concentration notable`);
    const topSec = Object.entries(c.sector || {}).sort((a, b) => b[1] - a[1])[0];
    if (topSec && topSec[1] > 35) bits.push(`${topSec[0]} pèse ${topSec[1]} % de l'indice`);
    const topGeo = Object.entries(c.geo || {}).sort((a, b) => b[1] - a[1])[0];
    if (topGeo && topGeo[1] > 65) bits.push(`${topGeo[0]} pèse ${topGeo[1]} % — forte dépendance à une seule zone`);
    if (r.stats && has(r.stats.maxDD) && Math.abs(r.stats.maxDD) > 30) bits.push(`a déjà baissé de ${pctA(r.stats.maxDD)} sur la période observée`);
    if (!bits.length) bits.push('pas de risque structurel saillant ; le risque de marché reste entier');
    return bits.join(' ; ') + '.';
  }
  function placeLine(r, ctx) {
    const gap = (ctx.snap.target.etf || 0) - (ctx.snap.alloc.etf || 0);
    const bits = [];
    if (r.fit && has(r.fit.overlapGeo)) {
      bits.push(r.fit.overlapGeo < 45
        ? `Recouvrement faible avec ce que tu détiens (${r.fit.overlapGeo.toFixed(0)} %) : rôle de **diversifiant**.`
        : r.fit.overlapGeo > 80
          ? `Recouvrement fort (${r.fit.overlapGeo.toFixed(0)} %) : rôle de **renforcement**, pas de diversification.`
          : `Recouvrement moyen (${r.fit.overlapGeo.toFixed(0)} %) : complément utile sans doublon massif.`);
    }
    if (gap > 3) bits.push(`Ta poche ETF est ${gap.toFixed(1)} points sous sa cible : il y a de la place pour l'accueillir.`);
    else if (gap < -3) bits.push(`Ta poche ETF dépasse déjà sa cible de ${(-gap).toFixed(1)} points : je n'en ferais pas une priorité ce mois-ci.`);
    return bits.join(' ');
  }

  /* --------------------------------------------------------- ETF monde ciblé */
  async function respEtfWorld() {
    const { ranked, ctx } = await E().rankEtfs(null, 40);
    const world = ranked.filter(r => /world|all-world|acwi/i.test(r.cat.index)).slice(0, 3);
    if (!world.length) return `Aucun ETF monde dans le catalogue.`;
    let o = header('ETF Monde — ce que je retiens pour toi');
    o += `<span class="muted sm">Un ETF monde est la brique la plus cohérente avec un profil équilibré sur ${G.Store.state.profile.horizonYears} ans : il t'évite d'avoir à choisir le bon pays ou le bon secteur.</span>\n\n`;
    world.forEach((r, i) => {
      const c = r.cat;
      o += `**${i + 1}. ${c.name}** — ${r.score}/100\n\n`;
      o += `- Indice : ${c.index}${has(c.holdings) ? `, ${c.holdings.toLocaleString('fr-FR')} lignes` : ''}\n`;
      o += `- Frais : ${has(c.ter) ? c.ter + ' %/an' : '—'}${c.pea ? ' · **éligible PEA**' : ' · CTO/AV uniquement'}\n`;
      o += `- ${c.replication}, ${c.dist.toLowerCase()}, libellé en ${c.currency}\n`;
      if (r.stats) o += `- Mesuré sur ${r.stats.years.toFixed(1)} ans : volatilité ${pctA(r.stats.vol)}, pire baisse ${pctA(r.stats.maxDD)} *(${r.stats.source})*\n`;
      if (c.note) o += `- ${c.note}\n`;
      o += '\n';
    });
    const pea = world.find(r => r.cat.pea);
    o += `\n**Comment je choisirais** : si tu investis dans un **PEA**, ${pea ? `l'option praticable est ${pea.cat.name} malgré ses frais plus élevés — l'avantage fiscal après 5 ans compense généralement l'écart de frais.` : `aucun ETF monde du catalogue n'est éligible PEA.`} Sur un **CTO ou une assurance-vie**, prends le moins cher à indice équivalent.\n`;
    o += confLine(world[0].confidence);
    return o;
  }

  /* ------------------------------------------------------- Meilleures actions */
  async function respBestStocks() {
    if (!G.Market.hasProvider()) return noProviderMsg('actions');
    const snap = G.Store.snapshot();
    const exp = E().exposures(snap);
    const uni = G.DATA.STOCK_UNIVERSE.map(u => u.t)
      .concat(G.Store.state.watchlist.map(w => w.ticker));
    const results = [];
    for (const t of Array.from(new Set(uni)).slice(0, 14)) {
      try { const s = await E().scoreStock(t, { snap, exp }); if (!s.noData && has(s.score)) results.push(s); }
      catch (e) { /* ignoré */ }
    }
    if (!results.length) return `Aucun fournisseur n'a renvoyé de fondamentaux exploitables. Je ne vais pas inventer des chiffres : vérifie tes clés dans **Réglages**, puis relance.`;
    results.sort((a, b) => b.score - a.score);
    let o = header('Actions les plus intéressantes selon mon analyse');
    o += `<span class="muted sm">${results.length} sociétés analysées sur données réelles. Je ne cherche pas ce qui « va monter » : je cherche le meilleur rapport qualité / valorisation / risque / adéquation à ton portefeuille.</span>\n\n`;
    results.slice(0, 4).forEach((s, i) => { s.why = whyStockShort(s); o += stockBlock(s, i + 1); });
    const worst = results[results.length - 1];
    if (worst && worst.score < 45) {
      o += `\n---\n\n**Ce que j'écarte** : ${worst.name} (${worst.score}/100) — ${worst.conclusion.label.toLowerCase()}. ${worst.fitReasons[0] || ''}\n`;
    }
    return o;
  }

  function stockBlock(s, n) {
    let o = `\n**${n ? n + '. ' : ''}${s.name}** (${s.ticker}) — ` +
      (has(s.score) ? `Score InvestAI : **${s.score}/100**` : `**Score non calculable**`) + `\n\n`;
    if (!s.reliable) {
      o += `Je n'affiche pas de score global : seules **${s.dimensions} des 6 dimensions** ont pu être calculées avec les données disponibles. ` +
        `Un score partiel donnerait une fausse impression de précision.\n\n`;
    }
    const lbl = { croissance:'Croissance', rentabilite:'Rentabilité', valorisation:'Valorisation', dette:'Dette', qualite:'Qualité', risque:'Risque' };
    const parts = Object.entries(s.subs).filter(([, v]) => has(v))
      .map(([k, v]) => `${lbl[k]} : ${v.toFixed(0)}/10`);
    o += parts.join(' · ') + '\n\n';
    const f = s.fundamentals;
    const fbits = [];
    if (has(f.pe)) fbits.push(`PER ${f.pe.toFixed(1)}`);
    if (has(f.peg)) fbits.push(`PEG ${f.peg.toFixed(2)}${f._pegDerived ? ' (calculé)' : ''}`);
    if (has(f.netMargin)) fbits.push(`marge nette ${pctA(f.netMargin)}`);
    if (has(f.roe)) fbits.push(`ROE ${pctA(f.roe)}`);
    if (has(f.revenueGrowth)) fbits.push(`croissance CA ${pctA(f.revenueGrowth)}`);
    if (has(f.debtToEquity)) fbits.push(`dette/fonds propres ${f.debtToEquity.toFixed(0)} %`);
    if (has(f.dividendYield)) fbits.push(`rendement ${pctA(f.dividendYield)}`);
    if (fbits.length) o += `<span class="muted sm">${fbits.join(' · ')}</span>\n\n`;
    if (s.stats) o += `<span class="muted sm">Volatilité ${pctA(s.stats.vol)}/an · pire baisse ${pctA(s.stats.maxDD)}${has(s.stats.perf1y) ? ` · 1 an ${pct(s.stats.perf1y)}` : ''}</span>\n\n`;
    (s.why || []).forEach(w => o += `- ${w}\n`);
    if (s.fitReasons && s.fitReasons.length) o += `- ${s.fitReasons[0]}\n`;
    o += `\n<div class="conclusion ${s.conclusion.cls}">${s.conclusion.label}</div>`;
    o += confLine(s.confidence);
    o += sourceLine(s.sources);
    return o;
  }

  /* ------------------------------------------------- Analyse d'un titre précis */
  async function respStock(ent, mode) {
    if (!ent.tickers.length) return `Précise le titre : par exemple « **est-ce qu'Apple est trop chère ?** » ou « **analyse NVDA** ».`;
    if (!G.Market.hasProvider()) return noProviderMsg('cette action');
    const t = ent.tickers[0];
    const s = await E().scoreStock(t);
    if (s.noData) {
      return `**${s.name}** — ${s.message}\n\nJe préfère te le dire franchement plutôt que de te livrer une analyse construite sur du vide.`;
    }
    s.why = whyStockShort(s);
    let o = header(mode === 'expensive' ? `${s.name} est-elle trop chère ?` : `Analyse — ${s.name}`);

    if (mode === 'expensive') {
      const v = s.subs.valorisation;
      const f = s.fundamentals;
      if (!has(v)) o += `Je n'ai pas les multiples de valorisation nécessaires pour trancher. Je ne vais pas te répondre au feeling.\n\n`;
      else {
        const verdict = v >= 7 ? 'Non, la valorisation reste raisonnable au regard de ses fondamentaux.'
          : v >= 5 ? 'Ni bon marché, ni excessive : la valorisation est dans une zone neutre.'
          : v >= 3.5 ? 'Elle est chère. Payable si la qualité suit, mais tu paies déjà beaucoup de bonnes nouvelles.'
          : 'Oui, à mon sens elle est trop chère aujourd\'hui.';
        o += `**${verdict}** *(valorisation ${v.toFixed(1)}/10)*\n\n`;
        const bits = [];
        if (has(f.pe)) bits.push(`PER de ${f.pe.toFixed(1)}`);
        if (has(f.peg)) bits.push(`PEG de ${f.peg.toFixed(2)}${f.peg < 1 ? ' — la croissance justifie en partie le multiple' : f.peg > 2 ? ' — le multiple dépasse nettement la croissance' : ''}`);
        if (has(f.pb)) bits.push(`price/book de ${f.pb.toFixed(1)}`);
        if (has(s.pos52)) bits.push(`cours situé à ${s.pos52.toFixed(0)} % de son canal 12 mois`);
        if (bits.length) o += bits.join(', ') + '.\n\n';
        if (has(s.subs.qualite) && s.subs.qualite >= 7 && v < 5) {
          o += `À noter : c'est une **entreprise de grande qualité** (${s.subs.qualite.toFixed(0)}/10). Excellente société, prix élevé — ce n'est pas la même chose qu'un mauvais dossier.\n\n`;
        }
      }
    }
    o += stockBlock(s, null);
    if (s.alreadyPct > 0) o += `\n<span class="muted sm">Tu détiens déjà cette ligne : ${pctA(s.alreadyPct)} de ton patrimoine.</span>\n`;
    return o;
  }
  /** Chaque affirmation doit être adossée à une donnée effectivement reçue.
   *  Sans marge ni ROE, on ne parle pas de « marges solides » — même si le
   *  sous-score de qualité est élevé pour d'autres raisons (règle 1).        */
  function whyStockShort(s) {
    const out = [];
    const f = s.fundamentals, g = s.subs, st = s.stats;

    if (has(g.qualite) && g.qualite >= 7) {
      const bases = [];
      if (has(f.grossMargin)) bases.push(`marge brute de ${pctA(f.grossMargin)}`);
      if (has(f.operMargin)) bases.push(`marge opérationnelle de ${pctA(f.operMargin)}`);
      if (has(f.roe)) bases.push(`rentabilité des capitaux propres de ${pctA(f.roe)}`);
      if (bases.length) out.push(`Qualité élevée : ${bases.join(', ')}.`);
      else if (st && has(st.maxDD)) out.push(`Sous-score de qualité élevé, mais fondé uniquement sur la **stabilité du cours** (pire baisse ${pctA(st.maxDD)}) : je n'ai reçu aucune donnée de marge ni de rentabilité.`);
    }
    if (has(g.dette) && g.dette <= 4 && (has(f.debtToEquity) || has(f.currentRatio))) {
      out.push(`Endettement à surveiller${has(f.debtToEquity) ? ` (dette/fonds propres à ${f.debtToEquity.toFixed(0)} %)` : ''}.`);
    }
    if (has(g.croissance) && has(f.revenueGrowth)) {
      out.push(g.croissance >= 7
        ? `Croissance du chiffre d'affaires de ${pctA(f.revenueGrowth)} sur un an.`
        : g.croissance <= 3 ? `Croissance faible ou en repli (${pctA(f.revenueGrowth)} sur un an).` : '');
    }
    if (st && has(st.vol)) {
      out.push(`Volatilité mesurée de ${pctA(st.vol)}/an sur ${st.years.toFixed(1)} ans` +
        (has(g.risque) && g.risque <= 4 ? ` — élevée pour ton profil, une ligne à dimensionner prudemment.` : `.`));
    }
    if (s.secPct > 0 && s.sector) out.push(`Ton exposition actuelle au secteur ${s.sector} est de ${pctA(s.secPct)}.`);
    return out.filter(Boolean);
  }

  /* -------------------------------------------------------------- Comparaison */
  async function respCompare(ent) {
    if (ent.tickers.length < 2) {
      // comparaison ETF si mentionnés
      return `Donne-moi au moins deux titres à comparer, par exemple « **compare Apple, Microsoft et Nvidia** ».`;
    }
    if (!G.Market.hasProvider()) return noProviderMsg('ces titres');
    const snap = G.Store.snapshot(); const exp = E().exposures(snap);
    const res = [];
    for (const t of ent.tickers.slice(0, 4)) {
      try { const s = await E().scoreStock(t, { snap, exp }); res.push(s); } catch (e) { /* ignoré */ }
    }
    const ok = res.filter(r => !r.noData);
    const missing = res.filter(r => r.noData).map(r => r.ticker)
      .concat(ent.tickers.slice(0, 4).filter(t => !res.some(r => r.ticker === t.toUpperCase())));
    if (!ok.length) return `Aucune donnée exploitable pour ${ent.tickers.slice(0, 4).join(', ')}. Je ne peux pas comparer sur du vide.`;
    const scored = ok.filter(r => has(r.score));
    ok.sort((a, b) => (has(b.score) ? b.score : b.partialScore || 0) - (has(a.score) ? a.score : a.partialScore || 0));

    let o = header('Comparaison');
    if (!scored.length) {
      o += `<div class="conclusion c-info">Je n'ai pas reçu les fondamentaux (marges, PER, dette) de ces sociétés : ` +
        `je ne peux pas les noter. Voici en revanche ce que je <b>mesure réellement</b> sur leur historique de prix.</div>\n\n`;
    } else if (scored.length < ok.length) {
      o += `<span class="muted sm">Certains titres n'ont pas de score : leurs fondamentaux manquent. Comparer un titre noté à un titre non noté n'aurait pas de sens — je le signale plutôt que de le masquer.</span>\n\n`;
    }
    o += `| | ${ok.map(s => s.name).join(' | ')} |\n|---|${ok.map(() => '---').join('|')}|\n`;
    const row = (lbl, fn) => `| **${lbl}** | ${ok.map(fn).join(' | ')} |`;
    const L = [];
    L.push(row('Score InvestAI', s => has(s.score) ? `**${s.score}/100**` : 'non calculable'));
    L.push(row('Croissance', s => has(s.subs.croissance) ? s.subs.croissance.toFixed(0) + '/10' : '—'));
    L.push(row('Rentabilité', s => has(s.subs.rentabilite) ? s.subs.rentabilite.toFixed(0) + '/10' : '—'));
    L.push(row('Valorisation', s => has(s.subs.valorisation) ? s.subs.valorisation.toFixed(0) + '/10' : '—'));
    L.push(row('Dette', s => has(s.subs.dette) ? s.subs.dette.toFixed(0) + '/10' : '—'));
    L.push(row('Qualité', s => has(s.subs.qualite) ? s.subs.qualite.toFixed(0) + '/10' : '—'));
    L.push(row('Risque', s => has(s.subs.risque) ? s.subs.risque.toFixed(0) + '/10' : '—'));
    L.push(row('PER', s => has(s.fundamentals.pe) ? s.fundamentals.pe.toFixed(1) : '—'));
    L.push(row('Marge nette', s => has(s.fundamentals.netMargin) ? pctA(s.fundamentals.netMargin) : '—'));
    L.push(row('Volatilité', s => s.stats && has(s.stats.vol) ? pctA(s.stats.vol) + '/an' : '—'));
    L.push(row('Pire baisse', s => s.stats && has(s.stats.maxDD) ? pctA(s.stats.maxDD) : '—'));
    L.push(row('Perf. 1 an', s => s.stats && has(s.stats.perf1y) ? pct(s.stats.perf1y, 1) : '—'));
    L.push(row('Canal 12 mois', s => has(s.pos52) ? s.pos52.toFixed(0) + ' %' : '—'));
    L.push(row('Déjà détenu', s => s.alreadyPct > 0 ? pctA(s.alreadyPct) : '—'));
    L.push(row('Confiance', s => s.confidence.score + '/100'));
    L.push(row('Conclusion', s => s.conclusion.label));
    o += L.join('\n') + '\n';

    const best = ok[0];
    o += `\n**Ce que j'en retire**\n\n`;
    if (!scored.length) {
      const withVol = ok.filter(s => s.stats && has(s.stats.vol)).sort((a, b) => a.stats.vol - b.stats.vol);
      o += `Sans fondamentaux, je m'interdis de désigner un gagnant : la volatilité passée ne dit rien de la qualité d'une entreprise.`;
      if (withVol.length >= 2) o += ` Le seul constat mesurable est que **${withVol[0].name}** a été le moins volatil (${pctA(withVol[0].stats.vol)}/an contre ${pctA(withVol[withVol.length - 1].stats.vol)}/an pour ${withVol[withVol.length - 1].name}).`;
      else if (withVol.length === 1) o += ` Je n'ai d'ailleurs récupéré l'historique que d'**un seul** des titres demandés : il n'y a pas de comparaison possible.`;
      o += ` Ajoute une clé Finnhub gratuite dans **Réglages** pour que je puisse réellement les comparer.`;
      if (missing.length) o += `\n\n<span class="muted sm">Aucune donnée reçue pour : ${missing.join(', ')}. Vérifie le symbole exact attendu par ton fournisseur.</span>`;
      return o;
    }
    if (missing.length) o += `<span class="muted sm">Aucune donnée reçue pour : ${missing.join(', ')} — ces titres sont absents du tableau.</span>\n\n`;
    o += `Sur mes critères, **${best.name}** ressort en tête (${best.score}/100). `;
    const expensive = ok.filter(s => has(s.subs.valorisation) && s.subs.valorisation < 4);
    if (expensive.length) o += `${expensive.map(s => s.name).join(' et ')} ${expensive.length > 1 ? 'affichent' : 'affiche'} en revanche une valorisation tendue — la qualité est là, le prix aussi. `;
    const sameSector = new Set(ok.map(s => s.sector).filter(Boolean));
    if (sameSector.size === 1) {
      o += `\n\nAttention toutefois : ces sociétés appartiennent toutes au secteur **${Array.from(sameSector)[0]}**. En acheter plusieurs ne diversifie presque rien — tu ajoutes du risque sectoriel, pas de la robustesse.`;
    }
    o += `\n\n<span class="muted sm">Un score plus élevé ne signifie pas que le titre montera. Il signifie que, sur les critères mesurables et pour ton profil, le rapport qualité/prix/risque est meilleur aujourd'hui.</span>`;
    return o;
  }

  /* ----------------------------------------------------- Acheter ou attendre */
  async function respBuyNow(ent) {
    let o = header('Acheter maintenant ou attendre ?');
    o += `Ma réponse de fond, d'abord : sur un horizon de **${G.Store.state.profile.horizonYears} ans**, tenter de choisir le bon moment coûte statistiquement plus cher que d'investir régulièrement. Ce n'est pas une esquive, c'est le constat le plus robuste de la recherche sur le sujet.\n\n`;
    if (ent.tickers.length && G.Market.hasProvider()) {
      const s = await E().scoreStock(ent.tickers[0]);
      if (!s.noData) {
        o += `**Sur ${s.name} précisément**\n\n`;
        if (has(s.pos52)) o += `- Le cours est à **${s.pos52.toFixed(0)} %** de son canal 12 mois${s.pos52 > 85 ? ' — proche de ses plus hauts' : s.pos52 < 25 ? ' — proche de ses plus bas' : ''}.\n`;
        if (has(s.subs.valorisation)) o += `- Valorisation : **${s.subs.valorisation.toFixed(1)}/10**${s.subs.valorisation < 4 ? ' — chère. Si tu veux la posséder, j\'étalerais l\'entrée en plusieurs fois.' : s.subs.valorisation > 6.5 ? ' — raisonnable. Il n\'y a pas de raison évidente d\'attendre.' : ' — neutre.'}\n`;
        if (s.stats && has(s.stats.vol)) o += `- Volatilité de ${pctA(s.stats.vol)}/an : une baisse de 20 % en cours de route est un scénario ordinaire, pas un accident.\n`;
        o += `\n${s.conclusion.key === 'EXPENSIVE' || s.conclusion.key === 'RISKY'
          ? `Dans ce cas précis, **je n'entrerais pas d'un seul coup**. Fractionner en 3 fois sur 3 mois réduit le risque de mal tomber sans t'obliger à prédire quoi que ce soit.`
          : `Rien dans les données ne justifie d'attendre un meilleur moment.`}\n`;
        o += confLine(s.confidence);
        return o;
      }
    }
    const a = E().analysePortfolio();
    const dispo = Number(G.Store.state.profile.availableCash) || 0;
    if (dispo > 0 && dispo > (Number(G.Store.state.profile.monthlyBudget) || 0) * 6) {
      o += `**Dans ta situation** : tu as ${eur(dispo)} de capital disponible. Plutôt que d'attendre un signal qui ne viendra pas, j'étalerais ce capital sur **3 à 6 versements mensuels**. Tu gardes une part du bénéfice d'être investi tôt, tout en limitant le regret si le marché baisse juste après.\n`;
    } else {
      o += `**Dans ta situation** : ton capital est déjà largement investi. La question du moment se pose surtout pour tes versements à venir — et pour eux, la régularité fait le travail.\n`;
    }
    return o;
  }

  /* -------------------------------------------------------------- Mon plan */
  async function respPlan(ent) {
    const st = G.Store.state;
    // « 150 € tous les mois » → versement ; « j'ai 500 € » → capital de départ
    const monthly = ent.monthly || Number(st.profile.monthlyBudget) || 0;
    const others = ent.amounts.filter(a => a !== ent.monthly);
    const capital = others.length ? Math.max(...others) : (Number(st.profile.availableCash) || 0);
    const horizon = ent.years || st.profile.horizonYears || 10;
    const plan = await E().buildPlan({ capital, monthly, horizon });

    let o = header('Mon meilleur plan pour toi');
    o += `<span class="muted sm">Capital disponible ${eur(plan.capital)} · versement ${eur(plan.monthly)}/mois · horizon ${plan.horizon} ans · profil ${plan.prof.label.toLowerCase()}</span>\n\n`;

    if (plan.thisMonth.length) {
      o += `**Ce mois-ci** (${eur(plan.capital)})\n\n`;
      plan.thisMonth.forEach(l => {
        o += `- **${eur(l.amount)}** → ${l.label}${l.ticker ? ` (${l.ticker})` : ''}\n  <span class="muted sm">${l.why}</span>\n`;
      });
      o += '\n';
    }
    if (plan.recurring.length) {
      o += `**Chaque mois** (${eur(plan.monthly)})\n\n`;
      plan.recurring.forEach(l => {
        o += `- **${eur(l.amount)}** → ${l.label}${l.ticker ? ` (${l.ticker})` : ''}\n`;
      });
      o += '\n';
    }
    if (!plan.thisMonth.length && !plan.recurring.length) {
      o += `Aucun montant à répartir. Renseigne un capital disponible ou un versement mensuel dans **Réglages**.\n`;
    }

    const p = plan.proj;
    o += `\n**Projection sur ${p.years} ans** *(hypothèses, pas des prévisions)*\n\n`;
    o += `Total versé : **${eur(p.paid)}**\n\n`;
    o += `- Pessimiste (${pctA(p.rates.pess)}/an) : ${eur(p.scenarios.pess.final)}\n`;
    o += `- Central (${pctA(p.rates.central)}/an) : **${eur(p.scenarios.central.final)}** — soit ${eur(p.scenarios.central.final - p.paid)} de gains potentiels\n`;
    o += `- Optimiste (${pctA(p.rates.opti)}/an) : ${eur(p.scenarios.opti.final)}\n`;
    o += `\n<span class="muted sm">Sur ${p.mc.runs} trajectoires simulées avec une volatilité de ${pctA(p.rates.vol)}, la moitié des cas se situent entre ${eur(p.mc.p25)} et ${eur(p.mc.p75)}. Dans ${p.mc.lossProb.toFixed(0)} % des trajectoires, le résultat final reste inférieur au total versé.</span>\n`;

    if (plan.notes.length) o += `\n` + plan.notes.map(n => `<span class="muted sm">· ${n}</span>`).join('<br>');
    o += confLine(plan.confidence);
    return o;
  }

  /* ------------------------------------------------------------ Simulateur */
  function respSimulate(ent) {
    const st = G.Store.state;
    const snap = G.Store.snapshot();
    const years = ent.years || st.profile.horizonYears || 10;
    const monthly = ent.monthly || (ent.amounts.length > 1 ? ent.amounts[1] : Number(st.profile.monthlyBudget) || 0);
    const initial = ent.amounts.length && !ent.monthly ? ent.amounts[0] : snap.total;
    const sim = E().simulate({ initial, monthly, years, profile: snap.profile });

    let o = header(`Simulation sur ${years} ans`);
    o += `<span class="muted sm">Capital initial ${eur(sim.initial)} · versement ${eur(sim.monthly)}/mois · profil ${sim.profile.label.toLowerCase()}</span>\n\n`;
    o += `Total versé sur la période : **${eur(sim.paid)}**\n\n`;
    o += `| Scénario | Hypothèse | Valeur potentielle | Gains potentiels |\n|---|---|---|---|\n`;
    o += `| Pessimiste | ${pctA(sim.rates.pess)}/an | ${eur(sim.scenarios.pess.final)} | ${eur(sim.scenarios.pess.final - sim.paid)} |\n`;
    o += `| Central | ${pctA(sim.rates.central)}/an | **${eur(sim.scenarios.central.final)}** | **${eur(sim.scenarios.central.final - sim.paid)}** |\n`;
    o += `| Optimiste | ${pctA(sim.rates.opti)}/an | ${eur(sim.scenarios.opti.final)} | ${eur(sim.scenarios.opti.final - sim.paid)} |\n`;
    o += `\n**Distribution simulée** *(${sim.mc.runs} trajectoires, volatilité ${pctA(sim.rates.vol)}/an)*\n\n`;
    o += `- 1 cas sur 10 sous **${eur(sim.mc.p10)}**\n`;
    o += `- Médiane : **${eur(sim.mc.p50)}**\n`;
    o += `- 1 cas sur 10 au-dessus de **${eur(sim.mc.p90)}**\n`;
    o += `- Probabilité simulée de finir sous le total versé : **${sim.mc.lossProb.toFixed(0)} %**\n`;
    o += `\n<span class="muted sm">${sim.disclaimer}</span>`;
    return o;
  }

  /* ------------------------------------------------------- Bricks / immobilier */
  function respBricks() {
    const { ranked } = E().rankBricks();
    const candidates = ranked.filter(b => b.brick.status === 'candidat');
    let o = header('Projets immobiliers — classement rendement / risque');
    o += `<div class="conclusion c-watch">Le rendement annoncé n'est jamais garanti et le capital peut être perdu en totalité. Ces placements sont peu liquides avant l'échéance.</div>\n\n`;

    if (!ranked.length) {
      o += `Tu n'as enregistré aucun projet.\n\n**Pourquoi je ne vais pas en chercher moi-même** : Bricks ne publie pas d'API ouverte, et je ne récupérerai pas ces informations par des moyens non autorisés. ` +
        `Saisis les projets qui t'intéressent dans **Immobilier** (rendement, durée, garanties, promoteur, LTV) et je les classerai sur leur rapport rendement/risque — jamais sur le seul taux affiché.\n`;
      return o;
    }
    const list = candidates.length ? candidates : ranked;
    if (!candidates.length) o += `<span class="muted sm">Aucun projet marqué « candidat » : je classe donc l'ensemble de tes projets enregistrés.</span>\n\n`;

    list.slice(0, 5).forEach((b, i) => {
      const p = b.brick;
      o += `\n**${i + 1}. ${p.name || 'Projet sans nom'}** — score **${b.score}/100**\n\n`;
      o += `<span class="muted sm">${pctA(p.yieldPct)} annoncés · ${p.durationMonths} mois · ${p.location || 'localisation non renseignée'} · ${p.projectType || 'type non renseigné'}${p.promoter ? ' · ' + p.promoter : ''}</span>\n\n`;
      const comps = b.components.filter(c => has(c.v)).map(c => `${c.k} ${c.v.toFixed(0)}/10`);
      o += comps.join(' · ') + '\n\n';
      if (b.risks.length) o += `\n*Risques identifiés*\n\n` + b.risks.map(r => `- ${r}`).join('\n') + '\n';
      if (b.notes.length) o += `\n*Place dans ton portefeuille*\n\n` + b.notes.map(n => `- ${n}`).join('\n') + '\n';
      o += confLine(b.confidence);
    });

    const best = list[0], highYield = list.slice().sort((a, b) => (b.brick.yieldPct || 0) - (a.brick.yieldPct || 0))[0];
    if (highYield && best && highYield.brick.id !== best.brick.id) {
      o += `\n---\n\n**Pourquoi le plus rémunérateur n'est pas en tête** : ${highYield.brick.name} affiche ${pctA(highYield.brick.yieldPct)} contre ${pctA(best.brick.yieldPct)} pour ${best.brick.name}, ` +
        `mais son profil de risque est nettement moins favorable (${highYield.score}/100 contre ${best.score}/100). Un écart de rendement de quelques points ne compense pas un risque de perte en capital sensiblement plus élevé.\n`;
    }
    return o;
  }

  function respEtfVsBricks() {
    const snap = G.Store.snapshot();
    const a = E().analysePortfolio();
    let o = header('ETF ou immobilier participatif pour ton portefeuille ?');
    o += `Ce ne sont pas deux versions du même produit : ils jouent des rôles différents.\n\n`;
    o += `| | ETF actions | Immobilier participatif (Bricks) |\n|---|---|---|\n`;
    o += `| Liquidité | Vendable en quelques secondes | Bloqué jusqu'à l'échéance |\n`;
    o += `| Rendement | Non défini à l'avance, historiquement issu de la croissance des entreprises | Taux annoncé à l'avance, **non garanti** |\n`;
    o += `| Risque principal | Volatilité des marchés (baisses temporaires) | Défaut du promoteur (**perte en capital définitive**) |\n`;
    o += `| Diversification | Des centaines à des milliers de sociétés | Un projet = une contrepartie unique |\n`;
    o += `| Frais | ${'0,07 à 0,40 %/an'} | Prélevés par la plateforme, souvent peu visibles |\n`;
    o += `| Fiscalité | PEA possible (avantage après 5 ans) | Flat tax de 30 % en général |\n`;
    o += `\n**Dans ton cas précis**\n\n`;
    o += `- Ta poche ETF est à ${pctA(snap.alloc.etf)} pour une cible de ${snap.target.etf} %.\n`;
    o += `- Ta poche immobilière est à ${pctA(snap.alloc.immobilier)} pour une cible de ${snap.target.immobilier} %.\n\n`;
    const gapE = snap.target.etf - snap.alloc.etf, gapI = snap.target.immobilier - snap.alloc.immobilier;
    if (gapE > gapI + 3) o += `→ C'est **l'ETF** qui manque le plus dans ton allocation aujourd'hui. J'orienterais tes prochains versements de ce côté.\n`;
    else if (gapI > gapE + 3) o += `→ C'est **l'immobilier** qui est le plus en retard sur ta cible. À condition de sélectionner le projet sur ses garanties, pas sur son taux.\n`;
    else o += `→ Les deux poches sont à peu près à niveau. Répartis tes versements dans les proportions de ta cible.\n`;
    o += `\n**Mon avis de fond** : l'immobilier participatif apporte une décorrélation réelle et des flux réguliers, mais chaque projet est un pari sur **un seul promoteur**. `;
    o += `Pour un profil équilibré, je le vois comme un satellite plafonné à ta cible de ${snap.target.immobilier} % — jamais comme le cœur du portefeuille. Le cœur, ce sont les ETF larges et peu chers.\n`;
    o += confLine(a.confidence);
    return o;
  }

  /* ---------------------------------------------------------- Opportunités */
  async function respOpportunities(onProgress) {
    const r = await E().findOpportunities(onProgress);
    let o = header('⭐ Opportunités actuelles');
    if (r.notes.length) o += r.notes.map(n => `<span class="muted sm">· ${n}</span>`).join('<br>') + '\n\n';
    if (!r.list.length) return o + `\nJe n'ai rien à te proposer avec un niveau de confiance suffisant. C'est une réponse honnête, pas un bug : sans données fiables, une recommandation n'a aucune valeur.`;
    r.list.slice(0, 6).forEach((x, i) => {
      const badge = { etf: 'ETF', action: 'Action', immo: 'Immobilier' }[x.kind];
      o += `\n**${i + 1}. ${x.name}** ${x.ticker ? `(${x.ticker})` : ''} · *${badge}*\nScore : **${x.score}/100**\n\n`;
      o += x.why.map(w => `- ${w}`).join('\n') + '\n';
      o += confLine(x.confidence);
    });
    o += `\n---\n\n<span class="muted sm">Cette liste répond à la question « quel investissement présente le meilleur rapport entre qualité, potentiel, risque, valorisation et adéquation à mon portefeuille ? » — pas à « qu'est-ce qui va exploser ? ».</span>`;
    return o;
  }

  /* ------------------------------------------------------------- Journal */
  async function respJournal() {
    const r = await E().reviewJournal();
    let o = header('Est-ce que mes analyses étaient correctes ?');
    o += r.summary + '\n\n';
    if (r.stats) {
      o += `- Analyses matures (≥ 3 mois) : **${r.stats.total}**\n`;
      o += `- Avis favorables : ${r.stats.positive}${has(r.stats.avgPos) ? ` (évolution moyenne ${pct(r.stats.avgPos)})` : ''}\n`;
      o += `- Avis réservés : ${r.stats.negative}${has(r.stats.avgNeg) ? ` (évolution moyenne ${pct(r.stats.avgNeg)})` : ''}\n`;
      if (has(r.stats.avgConfidence)) o += `- Confiance moyenne affichée à l'époque : ${r.stats.avgConfidence.toFixed(0)}/100\n`;
      o += `\n<span class="muted sm">Un bon résultat sur quelques mois peut venir de la chance, et une bonne analyse peut donner un mauvais résultat. Ce que je mesure ici, c'est si mes avis **discriminent** — pas s'ils ont eu de la chance.</span>`;
    }
    return o;
  }

  /* ----------------------------------------------------------------- Aide */
  function respHelp() {
    const snap = G.Store.snapshot();
    let o = `Bonjour. Je suis **InvestAI**, ton analyste. Je connais ton portefeuille — ${eur(snap.total)} répartis en ${pctA(snap.alloc.etf)} ETF, ${pctA(snap.alloc.actions)} actions, ${pctA(snap.alloc.crypto)} crypto et ${pctA(snap.alloc.immobilier)} immobilier — et je le regarde **avant** de te proposer quoi que ce soit.\n\n`;
    o += `Tu peux me demander par exemple :\n\n`;
    o += `- « J'ai 300 € à investir ce mois-ci. »\n- « Trouve-moi les meilleurs ETF pour mon profil. »\n- « Est-ce qu'Apple est trop chère ? »\n- « Compare Apple, Microsoft et Nvidia. »\n- « Est-ce que je suis suffisamment diversifié ? »\n- « Quel serait le meilleur plan si j'investis 150 € tous les mois pendant 10 ans ? »\n- « Compare ETF et Bricks pour mon portefeuille. »\n- « Dois-je acheter maintenant ou attendre ? »\n\n`;
    o += `<span class="muted sm">Je ne te dirai jamais qu'un actif va monter, et je te dirai quand je n'ai pas assez de données pour conclure.</span>`;
    return o;
  }

  function noProviderMsg(what) {
    return `Je ne peux pas analyser ${what} : **aucun fournisseur de données n'est configuré**.\n\n` +
      `Je ne vais pas te livrer des chiffres inventés — c'est la règle que tu m'as fixée et c'est la plus importante de toutes.\n\n` +
      `Va dans **Réglages → Sources de données de marché** et colle une clé gratuite (Twelve Data pour les prix, Finnhub pour les fondamentaux). ` +
      `Cela prend deux minutes et reste gratuit. En attendant, tout ce qui concerne **ton portefeuille** (analyse, allocation, rééquilibrage, plan, simulation) fonctionne déjà parfaitement.`;
  }

  /* ================================================== ROUTAGE PRINCIPAL */
  async function route(text, onProgress) {
    const ent = extract(text);
    const intent = detect(text);
    switch (intent) {
      case 'analyse':       return respAnalyse();
      case 'diversif':      return respDiversif();
      case 'rebalance':     return respRebalance();
      case 'plan':          return await respPlan(ent);
      case 'simulate':      return respSimulate(ent);
      case 'invest':        return await respInvest(ent);
      case 'bestEtf':       return await respBestEtf(null, ent);
      case 'etfWorld':      return await respEtfWorld();
      case 'bestStocks':    return await respBestStocks();
      case 'expensive':     return await respStock(ent, 'expensive');
      case 'compare':       return await respCompare(ent);
      case 'buyNow':        return await respBuyNow(ent);
      case 'etfVsBricks':   return respEtfVsBricks();
      case 'bricks':        return respBricks();
      case 'opportunities': return await respOpportunities(onProgress);
      case 'journal':       return await respJournal();
      case 'stock':         return await respStock(ent, 'analyse');
      case 'help':          return respHelp();
      default:
        if (ent.tickers.length) return await respStock(ent, 'analyse');
        if (ent.amounts.length) return await respInvest(ent);
        return null;      // → tentative langage naturel étendu, sinon aide
    }
  }

  /* ======================================= MODE ÉTENDU (clé Anthropic) */
  /** Contexte transmis au modèle : chiffres calculés par engine.js uniquement. */
  function buildContext() {
    const a = E().analysePortfolio();
    const s = a.snap;
    const st = G.Store.state;
    return {
      profil: {
        type: s.profile.label, principal: 'Équilibré',
        horizon_ans: st.profile.horizonYears,
        budget_mensuel_eur: st.profile.monthlyBudget,
        capital_disponible_eur: st.profile.availableCash,
        allocation_cible_pct: s.target,
        limites: { position_max_pct: s.profile.maxSinglePosition, secteur_max_pct: s.profile.maxSectorExposure, poche_actions_max_pct: s.profile.maxStockSleeve }
      },
      patrimoine: {
        total_eur: Math.round(s.total), etf_eur: Math.round(s.etfValue), actions_eur: Math.round(s.stockValue),
        crypto_eur: Math.round(s.cryptoValue), immobilier_eur: Math.round(s.bricksValue),
        plus_value_eur: Math.round(s.pl), plus_value_pct: +s.plPct.toFixed(2),
        allocation_reelle_pct: Object.fromEntries(Object.entries(s.alloc).map(([k, v]) => [k, +v.toFixed(1)])),
        investi_ce_mois_eur: G.Store.investedInMonth(),
        revenus_12m_eur: Math.round(G.Store.incomeLast12m())
      },
      positions: s.holdings.map(h => ({
        type: h.type, ticker: h.ticker, nom: h.name, quantite: h.quantity,
        prix_revient: h.avgPrice, prix_actuel: h._live ? h._price : null,
        source_prix: h._priceSource, date_prix: h._priceDate,
        valeur_eur: Math.round(h._value), plus_value_pct: +h._plPct.toFixed(2),
        poids_pct: s.total ? +(h._value / s.total * 100).toFixed(1) : 0,
        compte: h.account, secteur: h.sector, region: h.region
      })),
      immobilier: st.bricks.map(b => ({
        nom: b.name, montant_eur: b.amount, rendement_annonce_pct: b.yieldPct,
        duree_mois: b.durationMonths, statut: b.status, promoteur: b.promoter,
        garanties: b.guarantees, localisation: b.location, ltv: b.ltv, en_retard: b.delayed
      })),
      analyse: {
        score_diversification_sur_100: a.divScore, niveau_risque: a.riskLabel,
        volatilite_estimee_pct: has(a.portVol) ? +a.portVol.toFixed(1) : null,
        part_volatilite_mesuree_pct: +a.volMeasured.toFixed(0),
        concentration: a.concentrationLabel, poids_plus_grosse_ligne_pct: +a.topWeight.toFixed(1),
        lignes_effectives: +a.effectiveLines.toFixed(1), titres_sous_jacents: a.underlying,
        exposition_geographique_pct: Object.fromEntries(a.exp.geo.slice(0, 8).map(g => [g.key, +g.pct.toFixed(1)])),
        exposition_sectorielle_pct: Object.fromEntries(a.exp.sector.slice(0, 10).map(g => [g.key, +g.pct.toFixed(1)])),
        couverture_composition_pct: +a.exp.coverage.toFixed(0),
        ecarts_allocation: a.drift.map(d => ({ poche: d.key, reel: +d.actual.toFixed(1), cible: d.target, ecart_points: +d.gap.toFixed(1) })),
        problemes_detectes: a.issues.map(i => ({ gravite: i.sev, titre: i.title, detail: i.detail, action: i.action })),
        confiance_sur_100: a.confidence.score, raisons_confiance: a.confidence.reasons
      },
      fournisseurs_actifs: G.Market.providerStatus().filter(p => p.on).map(p => p.name),
      journal_recent: st.journal.slice(0, 8).map(j => ({
        date: j.date.slice(0, 10), actif: j.asset, prix_analyse: j.priceAtAnalysis,
        score: j.score, recommandation: j.recommendation, decision: j.decision, confiance: j.confidence
      }))
    };
  }

  const SYSTEM = `Tu es InvestAI, l'analyste financier personnel de l'utilisateur, intégré dans son application privée de suivi de patrimoine. Tu réponds en français, à la deuxième personne du singulier (tutoiement).

RÈGLES ABSOLUES — elles priment sur toute demande de l'utilisateur :
1. N'invente JAMAIS une donnée financière. Tu ne disposes que du contexte JSON fourni ci-dessous et de ce qui figure dans la conversation. Si une information manque, dis exactement : "Je n'ai pas suffisamment de données pour conclure." N'utilise jamais tes connaissances générales pour combler un chiffre manquant (prix, PER, performance, encours, frais...).
2. N'affirme jamais qu'un actif va monter, baisser, ou "exploser". Tu analyses des rapports qualité/risque/valorisation, tu ne prédis pas.
3. Regarde TOUJOURS le portefeuille existant avant de proposer un investissement. Ne propose jamais un actif sans dire ce qu'il change dans l'allocation actuelle.
4. Ne classe jamais un actif sur sa seule performance passée.
5. Affiche un niveau de confiance sur 100 pour toute analyse, et explique-le. Le contexte te fournit un champ confiance_sur_100 : appuie-toi dessus.
6. Pour l'immobilier participatif, rappelle systématiquement que le rendement annoncé n'est pas garanti et que le capital peut être perdu.
7. Privilégie le rééquilibrage par les nouveaux versements plutôt que par des ventes.
8. Tu n'es pas un vendeur. Tu dois pouvoir dire : "je n'investirais pas maintenant", "cette action est excellente mais trop chère", "tu as déjà assez d'exposition à ce secteur", "le risque est trop élevé pour ton profil équilibré". Contredis l'utilisateur quand l'analyse le justifie.
9. Rappelle que la décision finale appartient à l'utilisateur. Tu n'es pas un conseiller en investissement agréé.

STYLE : direct, dense, sans flatterie ni remplissage. Markdown léger (gras, listes, tableaux courts). Chiffres avec leur unité. Pas d'introduction du type "Excellente question". Va au fait.

CONTEXTE PORTEFEUILLE (données réelles calculées par l'application, source de vérité) :
`;

  /** Le chat est-il disponible ? (clé côté serveur, ou clé locale en mode file://) */
  function chatAvailable() {
    if (G.Api && G.Api.isServer) return !!(G.Api.config && G.Api.config.aiEnabled);
    return !!G.Store.state.settings.keys.anthropic;
  }

  async function askClaude(text, history) {
    const ctx = buildContext();
    const messages = (history || []).slice(-10).map(m => ({ role: m.role, content: m.text }));
    messages.push({ role: 'user', content: text });
    const system = SYSTEM + JSON.stringify(ctx, null, 1);

    // Mode serveur : la clé ne quitte jamais le VPS.
    if (G.Api && G.Api.isServer) return await G.Api.chat(system, messages);

    const key = G.Store.state.settings.keys.anthropic;
    if (!key) return null;
    const body = {
      model: 'claude-sonnet-5',
      max_tokens: 2000,
      system: SYSTEM + JSON.stringify(ctx, null, 1),
      messages
    };
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error('API Anthropic ' + r.status + ' : ' + t.slice(0, 200));
    }
    const j = await r.json();
    return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  }

  /* ---------------------------------------------------------- point d'entrée */
  async function ask(text, opts) {
    opts = opts || {};

    // 1) intention explicite reconnue → moteur local (chiffres garantis)
    let local = null;
    try { local = await route(text, opts.onProgress); }
    catch (e) { console.error(e); local = `Une erreur est survenue pendant l'analyse : ${e.message}`; }
    if (local) return { text: local, mode: 'local' };

    // 2) sinon, langage naturel étendu si le chat est disponible
    if (chatAvailable()) {
      try {
        const r = await askClaude(text, opts.history);
        if (r) return { text: r, mode: 'claude' };
      } catch (e) {
        return { text: `Je n'ai pas pu joindre le service de langage naturel (${e.message}).\n\n` + respHelp(), mode: 'local' };
      }
    }
    // 3) repli : aide
    return { text: `Je n'ai pas identifié précisément ta demande.\n\n` + respHelp(), mode: 'local' };
  }

  /* ---------------------------------------- Message d'accueil du tableau de bord */
  async function dailyBrief() {
    const a = E().analysePortfolio();
    const s = a.snap;
    if (s.total <= 0) {
      return `Bonjour. Ton portefeuille est encore vide. Commence par saisir tes positions réelles dans <b>Portefeuille</b> — je ne peux rien analyser d'utile sans savoir ce que tu détiens.`;
    }
    const bits = [];
    const LBL = { etf:'ta poche ETF', actions:'ta poche actions', crypto:'ta poche crypto', immobilier:'ton immobilier' };
    const maxDrift = a.drift.reduce((m, d) => Math.abs(d.gap) > Math.abs(m.gap) ? d : m, a.drift[0]);

    // 1) où en est l'allocation
    if (Math.abs(maxDrift.gap) < 5) bits.push('Ton allocation reste proche de ton objectif');
    else bits.push(`${LBL[maxDrift.key].replace(/^./, c => c.toUpperCase())} s'écarte de ${Math.abs(maxDrift.gap).toFixed(1)} points de ta cible ` +
      `(${maxDrift.actual.toFixed(1)} % contre ${maxDrift.target} % visés)`);

    // 2) le point le plus saillant, formulé comme une observation
    const top = a.issues.filter(i => i.sev >= 3)[0] || a.issues.filter(i => i.sev >= 2 && !/Écart d'allocation/.test(i.title))[0];
    if (top) bits.push(top.detail.replace(/^./, c => c.toLowerCase()).replace(/\.$/, ''));

    // 3) diversification
    if (a.divScore >= 75) bits.push(`ta diversification reste solide (${a.divScore}/100)`);
    else if (a.divScore < 55) bits.push(`ta diversification reste perfectible (${a.divScore}/100)`);

    const stale = s.holdings.filter(h => !h._live).length;
    let out = `Bonjour. ${bits.join(', et ').replace(/^./, c => c.toUpperCase())}.`;
    if (stale) out += ` <span class="muted">${stale} ligne(s) sont encore valorisées à leur prix de revient faute de données de marché — clique sur <b>Actualiser</b>.</span>`;
    if (!G.Market.hasProvider()) out += ` <span class="muted">Aucun fournisseur de données configuré : je m'en tiens à ce que tu as saisi, sans rien inventer.</span>`;
    return out;
  }

  G.Agent = { ask, route, extract, detect, dailyBrief, buildContext, respAnalyse, respHelp, chatAvailable };
})(window);
