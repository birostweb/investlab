/* ============================================================================
   main.js — Câblage de l'application
   ========================================================================== */
(function (G) {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const U = () => G.UI;
  const has = v => v !== null && v !== undefined && isFinite(v);
  const eur = v => U().eur(v);
  const pctA = (v, d) => U().pctA(v, d);

  /* ------------------------------------------------------------- démarrage */
  G.Store.load();
  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();

  let booted = false;

  /** Détecte le mode (serveur ou local), gère la connexion, puis démarre. */
  async function boot() {
    if (booted) return; booted = true;
    wireGate();
    let st;
    try { st = await G.Api.detect(); }
    catch (e) { st = { mode: 'local', authed: true }; }

    if (G.Api.isServer && !G.Api.authed) return showGate();   // init() après connexion
    if (G.Api.isServer) { try { await G.Store.loadRemote(); } catch (e) { console.warn(e); } }
    init();
  }

  function showGate() {
    $('#gate').hidden = false;
    setTimeout(() => { const i = $('#gatePass'); if (i) i.focus(); }, 60);
  }
  function wireGate() {
    const f = $('#gateForm'); if (!f) return;
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = $('#gateBtn'), err = $('#gateErr');
      btn.disabled = true; err.textContent = '';
      try {
        await G.Api.login($('#gatePass').value);
        $('#gate').hidden = true;
        try { await G.Store.loadRemote(); } catch (e2) { console.warn(e2); }
        init();
      } catch (e2) {
        err.textContent = e2.message || 'Connexion impossible.';
        $('#gatePass').value = '';
        $('#gatePass').focus();
      } finally { btn.disabled = false; }
    });
  }

  let inited = false;
  function init() {
    if (inited) return; inited = true;
    wireNav();
    wireTopbar();
    wirePortfolio();
    wireEtf();
    wireStocks();
    wireBricks();
    wireOpportunities();
    wirePlan();
    wireSimulator();
    wireJournal();
    wireSettings();
    wireChat();
    wireModal();
    wireServerPanel();
    U().renderSettings();
    U().go('dashboard');
    U().renderChatHistory();

    // indicateur discret d'enregistrement (mode serveur)
    G.Api.onSaveStatus = s => {
      const el = $('#saveState'); if (!el) return;
      el.textContent = s === 'enregistrement' ? 'enregistrement…' : s === 'enregistré' ? 'enregistré' : s;
      el.style.color = /échec/.test(s) ? 'var(--neg)' : 'var(--ink-4)';
      if (s === 'enregistré') setTimeout(() => { if (el.textContent === 'enregistré') el.textContent = ''; }, 1800);
    };
  }

  /* ------------------------------------------------------- panneau serveur */
  function wireServerPanel() {
    const isServer = G.Api.isServer;
    const show = (sel, on) => { const e = $(sel); if (e) e.hidden = !on; };
    show('#serverPanel', isServer);
    show('#localKeysPanel', !isServer);
    show('#localAiPanel', !isServer);
    if (!isServer) return;

    const cfg = G.Api.config || {};
    $('#srvVersion').textContent = 'v' + (cfg.version || '?');
    $('#srvProviders').innerHTML = (cfg.providers || []).map(p => `
      <div class="provider">
        <div><strong>${U().esc(p.name)}</strong> <span class="muted sm">${U().esc(p.role)}</span></div>
        <span class="state ${p.on ? 'state-on' : 'state-off'}">${p.on ? '● configuré' : '○ non configuré'}</span>
      </div>`).join('');

    const mins = cfg.refreshMinutes;
    $('#srvStats').innerHTML = [
      ['Rafraîchissement auto', mins ? (mins >= 60 ? 'toutes les ' + (mins / 60) + ' h' : 'toutes les ' + mins + ' min') : 'désactivé'],
      ['Dernier rafraîchissement', cfg.lastRefresh ? new Date(cfg.lastRefresh).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'aucun depuis le démarrage'],
      ['Chat langage naturel', cfg.aiEnabled ? 'actif' : 'non configuré'],
      ['Stockage', 'sur ton serveur — synchronisé']
    ].map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${U().esc(v)}</span></div>`).join('');

    $('#btnServerRefresh').addEventListener('click', () => $('#btnRefresh').click());
    $('#btnLogout').addEventListener('click', async () => {
      if (!confirm('Se déconnecter de cet appareil ?')) return;
      await G.Api.flush();
      await G.Api.logout();
      location.reload();
    });
  }

  /* ---------------------------------------------------------------- nav */
  function wireNav() {
    $('#nav').addEventListener('click', e => {
      const b = e.target.closest('.nav-item'); if (!b) return;
      U().go(b.dataset.view);
    });
  }

  function wireTopbar() {
    $('#btnRefresh').addEventListener('click', async () => {
      const btn = $('#btnRefresh');
      if (!G.Market.hasProvider()) {
        U().toast("Aucun fournisseur configuré. Va dans Réglages pour ajouter une clé gratuite.", 'err');
        U().go('settings'); return;
      }
      btn.disabled = true;
      const orig = btn.textContent;
      try {
        const r = await G.Market.refreshHoldings((d, t, tick, ok) => {
          btn.textContent = `↻ ${d}/${t} ${tick}${ok ? '' : ' ✕'}`;
        });
        U().toast(`${r.updated}/${r.total} ligne(s) actualisée(s).`, r.updated ? 'ok' : 'err');
        U().renderDashboard(); U().renderPortfolio();
      } catch (e) { U().toast('Échec : ' + e.message, 'err'); }
      btn.textContent = orig; btn.disabled = false;
    });

    $('#btnExport').addEventListener('click', () => {
      const blob = new Blob([G.Store.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `investai-sauvegarde-${G.Store.todayISO()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      U().toast('Sauvegarde téléchargée (sans tes clés API).', 'ok');
    });

    $('#fileImport').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          G.Store.importJSON(r.result);
          U().renderSettings(); U().go('dashboard'); U().renderChatHistory();
          U().toast('Sauvegarde importée.', 'ok');
        } catch (err) { U().toast('Fichier illisible : ' + err.message, 'err'); }
      };
      r.readAsText(f);
      e.target.value = '';
    });
  }

  /* ---------------------------------------------------------- portefeuille */
  function wirePortfolio() {
    $('#btnAddHolding').addEventListener('click', () => U().holdingModal());
    $('#btnAddTx').addEventListener('click', () => U().txModal());
    $('#btnAddCash').addEventListener('click', () => U().cashModal());

    document.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = b.dataset.id;
      switch (b.dataset.act) {
        case 'edit-h': U().holdingModal(id); break;
        case 'del-h': if (confirm('Supprimer cette position et ses mouvements ?')) { G.Store.removeHolding(id); U().renderPortfolio(); U().renderDashboard(); } break;
        case 'edit-c': U().cashModal(id); break;
        case 'del-c': if (confirm('Supprimer ce compte de liquidités ?')) { G.Store.removeCash(id); U().renderPortfolio(); U().renderDashboard(); } break;
        case 'del-tx': if (confirm('Supprimer ce mouvement ?')) { G.Store.removeTransaction(id); U().renderPortfolio(); U().renderDashboard(); } break;
        case 'edit-b': U().brickModal(id); break;
        case 'del-b': if (confirm('Supprimer ce projet ?')) { G.Store.removeBrick(id); U().renderBricksList(); U().renderDashboard(); } break;
        case 'del-w': G.Store.removeWatch(id); U().renderWatchlist(); break;
        case 'del-j': if (confirm('Supprimer cette entrée du journal ?')) { G.Store.removeJournal(id); U().renderJournal(); } break;
        case 'analyse-w': $('#stockLookup').value = b.dataset.ticker; U().analyseStock(b.dataset.ticker); break;
        case 'journal-add': journalFromAnalysis(b.dataset); break;
      }
    });
    document.addEventListener('change', e => {
      const s = e.target.closest('select[data-act="dec"]'); if (!s) return;
      G.Store.updateJournal(s.dataset.id, { decision: s.value });
      U().toast('Décision enregistrée.', 'ok');
    });
  }

  function journalFromAnalysis(d) {
    const body = `<div class="field-grid">
      ${U().field('asset', 'Actif', { full: true, value: d.name + ' (' + d.ticker + ')' })}
      ${U().field('priceAtAnalysis', "Prix au moment de l'analyse (€)", { type: 'number', value: d.price })}
      ${U().field('score', 'Score InvestAI', { type: 'number', value: d.score })}
      ${U().field('confidence', 'Confiance', { type: 'number', value: d.conf })}
      ${U().field('recommendation', 'Recommandation', { full: true, value: d.reco })}
      ${U().field('reason', "Raison de l'analyse", { full: true, value: '' })}
      ${U().field('risks', 'Risques identifiés', { full: true, value: '' })}
      ${U().field('decision', 'Ma décision', { full: true, type: 'select', value: 'en attente', options: [
        { v:'en attente', l:'En attente' }, { v:'suivie', l:'Suivie — j\'ai investi' },
        { v:'ignorée', l:'Ignorée' }, { v:'refusée', l:'Refusée — je ne suis pas d\'accord' }] })}
    </div>
    <p class="note" style="margin-top:14px">Cette trace permettra plus tard de vérifier si l'analyse était pertinente — en jugeant le raisonnement, pas seulement le résultat.</p>`;
    U().openModal('Enregistrer dans le journal', body, null, () => {
      const v = U().modalValues();
      v.ticker = d.ticker; v.assetType = 'action';
      G.Store.addJournal(v);
      U().toast('Enregistré dans le journal.', 'ok');
      U().renderJournal();
    });
  }

  /* ------------------------------------------------------------------ ETF */
  function wireEtf() {
    $('#btnRankEtf').addEventListener('click', () => {
      const f = $('#etfFilterPea').value;
      U().renderEtfRanking(f === 'all' ? null : f);
    });
    $('#etfFilterPea').addEventListener('change', () => {
      const f = $('#etfFilterPea').value;
      U().renderEtfRanking(f === 'all' ? null : f);
    });
    $('#btnAddEtf').addEventListener('click', () => U().etfModal());
  }

  /* -------------------------------------------------------------- actions */
  function wireStocks() {
    $('#btnAnalyseStock').addEventListener('click', () => U().analyseStock($('#stockLookup').value.trim().toUpperCase()));
    $('#stockLookup').addEventListener('keydown', e => {
      if (e.key === 'Enter') U().analyseStock($('#stockLookup').value.trim().toUpperCase());
    });
    $('#btnCompare').addEventListener('click', () => U().compareWatchlist());
    $('#btnAddWatch').addEventListener('click', () => {
      const body = `<div class="field-grid">
        ${U().field('ticker', 'Ticker', { value: '', ph: 'AAPL, MC.PA…' })}
        ${U().field('name', 'Nom', { value: '' })}</div>
        <p class="note" style="margin-top:14px">Utilise le symbole reconnu par ton fournisseur (ex. <code>AAPL</code> pour les États-Unis, <code>MC.PA</code> pour Paris).</p>`;
      U().openModal('Ajouter à la watchlist', body, null, () => {
        const v = U().modalValues();
        if (!v.ticker) { U().toast('Renseigne un ticker.', 'err'); return false; }
        v.ticker = v.ticker.toUpperCase();
        G.Store.addWatch(v); U().renderWatchlist(); U().toast('Ajouté.', 'ok');
      });
    });
  }

  /* ----------------------------------------------------------- immobilier */
  function wireBricks() {
    $('#btnAddBrick').addEventListener('click', () => U().brickModal());
    $('#btnRankBricks').addEventListener('click', () => { U().renderBricksList(); U().toast('Classement mis à jour.', 'ok'); });
  }

  /* --------------------------------------------------------- opportunités */
  function wireOpportunities() {
    $('#btnScan').addEventListener('click', async () => {
      const btn = $('#btnScan'), el = $('#oppList');
      btn.disabled = true;
      el.innerHTML = `<div class="empty">Analyse en cours…</div>`;
      try {
        const r = await G.Engine.findOpportunities((i, n, t) => {
          el.innerHTML = `<div class="empty">Analyse ${i}/${n} — ${U().esc(t)}…</div>`;
        });
        let html = '';
        if (r.notes.length) html += `<p class="note">${r.notes.map(U().esc).join('<br>')}</p>`;
        if (!r.list.length) {
          html += `<div class="empty">Aucune opportunité avec un niveau de confiance suffisant.<br>
            <span class="muted">C'est une réponse honnête, pas une panne : sans données fiables, une recommandation n'a aucune valeur.</span></div>`;
        } else {
          html += r.list.map((x, i) => oppCard(x, i)).join('');
        }
        el.innerHTML = html;
      } catch (e) { el.innerHTML = `<div class="empty">Erreur : ${U().esc(e.message)}</div>`; }
      btn.disabled = false;
    });
  }
  function oppCard(x, i) {
    const badge = { etf: 'ETF', action: 'Action', immo: 'Immobilier' }[x.kind];
    const cls = { etf: 'etf', action: 'action', immo: 'immo' }[x.kind];
    return `<div class="rank-card ${i < 3 ? 'top' : ''}">
      <div class="rank-head">
        <div class="rank-no">${i + 1}</div>
        <div class="rank-title"><strong>${U().esc(x.name)}</strong>
          <span class="sub"><span class="tag ${cls}">${badge}</span>${x.ticker ? ' ' + U().esc(x.ticker) : ''}</span></div>
        <div class="score-badge"><div class="v ${U().scoreCls(x.score)}">${x.score}</div><div class="l">/100</div></div>
      </div>
      <div class="rank-body"><h5>Pourquoi elle apparaît ici</h5>
        <ul>${x.why.map(w => `<li>${w}</li>`).join('')}</ul></div>
      ${x.kind === 'immo' ? `<div class="conclusion c-watch">Rendement annoncé non garanti · capital pouvant être perdu</div>` : ''}
      ${U().confHTML(x.confidence)}
    </div>`;
  }

  /* ---------------------------------------------------------------- plan */
  function wirePlan() {
    $('#btnBuildPlan').addEventListener('click', async () => {
      const el = $('#planOutput');
      el.innerHTML = `<div class="empty">Construction du plan — analyse de ton portefeuille…</div>`;
      const plan = await G.Engine.buildPlan({
        capital: Number($('#planCapital').value) || 0,
        monthly: Number($('#planMonthly').value) || 0,
        horizon: Number($('#planHorizon').value) || 10,
        profile: $('#planProfile').value
      });
      el.innerHTML = renderPlan(plan);
      const c = el.querySelector('#planChart');
      if (c) G.Charts.projection(c, plan.proj);
    });
    $('#btnRebalance').addEventListener('click', () => {
      const r = G.Engine.rebalance();
      $('#rebalanceOutput').innerHTML = renderRebalance(r);
    });
  }

  function renderPlan(p) {
    let h = `<div class="conclusion c-info">Plan construit à partir de ton portefeuille réel (${eur(p.snap.total)}), de ton profil ${p.prof.label.toLowerCase()} et de ton horizon de ${p.horizon} ans. Les montants s'ajustent automatiquement à ce que tu détiens déjà.</div>`;

    if (p.thisMonth.length) {
      h += `<div class="plan-block"><h4>Ce mois-ci — ${eur(p.capital)}</h4>` +
        p.thisMonth.map(l => `<div class="plan-line">
          <span class="amt">${eur(l.amount)}</span>
          <span class="nm"><strong>${U().esc(l.label)}${l.ticker ? ` <span class="muted">(${U().esc(l.ticker)})</span>` : ''}</strong>
            <span class="why">${U().esc(l.why)}</span></span>
          ${has(l.score) ? `<span class="score-badge"><span class="v ${U().scoreCls(l.score)}" style="font-size:16px">${l.score}</span></span>` : ''}
        </div>`).join('') + `</div>`;
    }
    if (p.recurring.length) {
      h += `<div class="plan-block"><h4>Chaque mois — ${eur(p.monthly)}</h4>` +
        p.recurring.map(l => `<div class="plan-line">
          <span class="amt">${eur(l.amount)}</span>
          <span class="nm"><strong>${U().esc(l.label)}${l.ticker ? ` <span class="muted">(${U().esc(l.ticker)})</span>` : ''}</strong>
            <span class="why">${U().esc(l.why)}</span></span>
        </div>`).join('') + `</div>`;
    }
    if (!p.thisMonth.length && !p.recurring.length) {
      h += `<div class="empty">Aucun montant à répartir. Renseigne un capital disponible ou un versement mensuel.</div>`;
    }

    const s = p.proj;
    h += `<div class="plan-block"><h4>Projection sur ${s.years} ans — hypothèses, pas des prévisions</h4>
      <div class="scenario-grid">
        <div class="scenario pess"><div class="h">Pessimiste · ${pctA(s.rates.pess)}/an</div>
          <div class="v">${eur(s.scenarios.pess.final)}</div><div class="d">${eur(s.scenarios.pess.final - s.paid)} de gains</div></div>
        <div class="scenario cent"><div class="h">Central · ${pctA(s.rates.central)}/an</div>
          <div class="v">${eur(s.scenarios.central.final)}</div><div class="d">${eur(s.scenarios.central.final - s.paid)} de gains</div></div>
        <div class="scenario opti"><div class="h">Optimiste · ${pctA(s.rates.opti)}/an</div>
          <div class="v">${eur(s.scenarios.opti.final)}</div><div class="d">${eur(s.scenarios.opti.final - s.paid)} de gains</div></div>
      </div>
      <div id="planChart"></div>
      <p class="muted sm" style="margin-top:10px">Total versé sur la période : <b>${eur(s.paid)}</b>. Sur ${s.mc.runs} trajectoires simulées, la moitié des cas se situent entre ${eur(s.mc.p25)} et ${eur(s.mc.p75)}, et ${s.mc.lossProb.toFixed(0)} % finissent sous le total versé.</p>
      <p class="muted sm">${s.disclaimer}</p></div>`;

    if (p.notes.length) h += `<p class="note">${p.notes.map(U().esc).join('<br>')}</p>`;
    h += U().confHTML(p.confidence);
    return h;
  }

  function renderRebalance(r) {
    let h = `<div class="conclusion ${r.tone}">${U().esc(r.verdict)}</div>`;
    h += `<div class="bars" style="margin:14px 0">`;
    const COL = G.DATA.ASSET_COLORS;
    r.rows.forEach(x => {
      const gap = x.gap;
      const cls = Math.abs(gap) < 5 ? 'drift-ok' : Math.abs(gap) < 12 ? 'drift-warn' : 'drift-bad';
      h += `<div class="bar-row"><div class="bar-top">
        <span class="nm">${x.label}<span class="drift-tag ${cls}">${gap >= 0 ? '+' : ''}${gap.toFixed(1)} pts · ${eur(x.euroGap)}</span></span>
        <span class="vl">${pctA(x.actual)} <span class="muted">/ ${x.target} %</span></span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, x.actual)}%;background:${COL[x.key === 'actions' ? 'actions' : x.key]}"></div>
        <div class="bar-target" style="left:${Math.min(100, x.target)}%"></div></div></div>`;
    });
    h += `</div>`;

    if (r.nextContrib.length && r.monthly > 0) {
      h += `<div class="plan-block"><h4>Orientation de tes prochains versements — ${eur(r.monthly)}/mois</h4>` +
        r.nextContrib.map(c => `<div class="plan-line"><span class="amt">${eur(c.amount)}</span>
          <span class="nm"><strong>${c.label}</strong><span class="why">${pctA(c.pct, 0)} du versement mensuel</span></span></div>`).join('') +
        (r.monthsToConverge ? `<p class="muted sm" style="margin-top:10px">À ce rythme, tu reviens sur ta cible en <b>environ ${r.monthsToConverge} mois</b> sans rien vendre.</p>` : '') +
        `</div>`;
    }
    if (r.sellCandidates.length) {
      h += `<div class="plan-block"><h4>Vente éventuelle</h4>` +
        r.sellCandidates.map(s => `<p>${U().esc(s.note)}</p>`).join('') + `</div>`;
    } else if (r.maxGap >= 5) {
      h += `<p class="note">Aucune vente recommandée : rediriger les versements ne coûte ni frais ni impôt, là où une vente déclenche les deux.</p>`;
    }
    return h;
  }

  /* ---------------------------------------------------------- simulateur */
  function wireSimulator() {
    $('#btnSimulate').addEventListener('click', () => {
      const snap = G.Store.snapshot();
      const sim = G.Engine.simulate({
        initial: Number($('#simInit').value) || 0,
        monthly: Number($('#simMonthly').value) || 0,
        years: Number($('#simYears').value) || 10,
        rate: Number($('#simRate').value),
        vol: Number($('#simVol').value),
        profile: snap.profile
      });
      $('#simOutput').innerHTML = renderSim(sim);
      G.Charts.projection($('#simChart'), sim);
    });
  }
  function renderSim(s) {
    return `<div class="scenario-grid">
      <div class="scenario pess"><div class="h">Pessimiste · ${pctA(s.rates.pess)}/an</div>
        <div class="v">${eur(s.scenarios.pess.final)}</div><div class="d">${eur(s.scenarios.pess.final - s.paid)} de gains potentiels</div></div>
      <div class="scenario cent"><div class="h">Central · ${pctA(s.rates.central)}/an</div>
        <div class="v">${eur(s.scenarios.central.final)}</div><div class="d">${eur(s.scenarios.central.final - s.paid)} de gains potentiels</div></div>
      <div class="scenario opti"><div class="h">Optimiste · ${pctA(s.rates.opti)}/an</div>
        <div class="v">${eur(s.scenarios.opti.final)}</div><div class="d">${eur(s.scenarios.opti.final - s.paid)} de gains potentiels</div></div>
    </div>
    <div class="kv" style="margin:16px 0">
      <div><span class="k">Total versé</span><span class="v">${eur(s.paid)}</span></div>
      <div><span class="k">Dont capital initial</span><span class="v">${eur(s.initial)}</span></div>
      <div><span class="k">Dont versements</span><span class="v">${eur(s.paid - s.initial)}</span></div>
      <div><span class="k">Durée</span><span class="v">${s.years} ans</span></div>
    </div>
    <div id="simChart"></div>
    <div class="plan-block" style="margin-top:16px"><h4>Distribution simulée · ${s.mc.runs} trajectoires</h4>
      <p class="muted sm">Au lieu de trois chiffres arbitraires, voici la dispersion obtenue en simulant des rendements mensuels aléatoires autour de ${pctA(s.rates.central)}/an avec une volatilité de ${pctA(s.rates.vol)}/an.</p>
      <div class="kv">
        <div><span class="k">1 cas sur 10 sous</span><span class="v">${eur(s.mc.p10)}</span></div>
        <div><span class="k">1er quartile</span><span class="v">${eur(s.mc.p25)}</span></div>
        <div><span class="k">Médiane</span><span class="v">${eur(s.mc.p50)}</span></div>
        <div><span class="k">3e quartile</span><span class="v">${eur(s.mc.p75)}</span></div>
        <div><span class="k">1 cas sur 10 au-dessus</span><span class="v">${eur(s.mc.p90)}</span></div>
        <div><span class="k">Finit sous le versé</span><span class="v">${s.mc.lossProb.toFixed(0)} %</span></div>
      </div>
    </div>
    <p class="note" style="margin-top:14px">${s.disclaimer}</p>`;
  }

  /* ------------------------------------------------------------- journal */
  function wireJournal() {
    $('#btnReviewJournal').addEventListener('click', () => U().reviewJournalUI());
  }

  /* ------------------------------------------------------------ réglages */
  function wireSettings() {
    const st = () => G.Store.state;
    const bind = (sel, fn) => $(sel).addEventListener('change', fn);
    bind('#setProfile', e => {
      st().profile.riskProfile = e.target.value;
      st().profile.target = Object.assign({}, G.DATA.PROFILES[e.target.value].target);
      G.Store.save(); U().renderSettings(); U().renderDashboard();
      U().toast(`Profil ${G.DATA.PROFILES[e.target.value].label} appliqué (allocation cible mise à jour).`, 'ok');
    });
    bind('#setHorizon', e => { st().profile.horizonYears = Number(e.target.value) || 10; G.Store.save(); U().renderDashboard(); });
    bind('#setMonthly', e => { st().profile.monthlyBudget = Number(e.target.value) || 0; G.Store.save(); U().renderSettings(); });
    bind('#setCapital', e => { st().profile.availableCash = Number(e.target.value) || 0; G.Store.save(); U().renderSettings(); U().renderDashboard(); });

    ['#tgtEtf', '#tgtActions', '#tgtImmo', '#tgtCash'].forEach(id => $(id).addEventListener('input', U().updateTargetSum));
    $('#btnSaveTarget').addEventListener('click', () => {
      const t = { etf: Number($('#tgtEtf').value) || 0, actions: Number($('#tgtActions').value) || 0,
                  immobilier: Number($('#tgtImmo').value) || 0, cash: Number($('#tgtCash').value) || 0 };
      const sum = t.etf + t.actions + t.immobilier + t.cash;
      if (sum !== 100) { U().toast(`Le total doit faire 100 % (actuellement ${sum} %).`, 'err'); return; }
      st().profile.target = t; G.Store.save();
      U().renderDashboard(); U().toast('Allocation cible enregistrée.', 'ok');
    });

    $('#btnResetProfile').addEventListener('click', () => {
      st().profile.riskProfile = 'equilibre';
      st().profile.target = Object.assign({}, G.DATA.PROFILES.equilibre.target);
      st().profile.horizonYears = 10;
      G.Store.save(); U().renderSettings(); U().renderDashboard();
      U().toast('Profil équilibré restauré comme configuration principale.', 'ok');
    });

    $('#btnSaveKeys').addEventListener('click', () => {
      st().settings.keys.twelvedata = $('#keyTwelve').value.trim();
      st().settings.keys.finnhub = $('#keyFinnhub').value.trim();
      st().settings.keys.alphavantage = $('#keyAlpha').value.trim();
      G.Store.save(); U().renderDashboard();
      U().toast('Clés enregistrées localement (elles ne quittent pas cette machine).', 'ok');
    });
    $('#btnTestKeys').addEventListener('click', async () => {
      const el = $('#keyTest');
      el.innerHTML = 'Test en cours…';
      st().settings.keys.twelvedata = $('#keyTwelve').value.trim();
      st().settings.keys.finnhub = $('#keyFinnhub').value.trim();
      st().settings.keys.alphavantage = $('#keyAlpha').value.trim();
      G.Store.save();
      const r = await G.Market.testKeys();
      el.innerHTML = r.length ? r.map(x =>
        `<div>${x.ok ? '<span style="color:var(--pos)">✓</span>' : '<span style="color:var(--neg)">✕</span>'} <b>${U().esc(x.n)}</b> — ${U().esc(x.d)}</div>`).join('')
        : 'Aucune clé saisie.';
    });
    $('#btnSaveAnthropic').addEventListener('click', () => {
      st().settings.keys.anthropic = $('#keyAnthropic').value.trim();
      G.Store.save(); U().renderChatHistory();
      U().toast(st().settings.keys.anthropic ? 'Langage naturel étendu activé.' : 'Mode local gratuit.', 'ok');
    });

    $('#btnSeed').addEventListener('click', () => {
      if (!confirm("Charger un jeu de démonstration ? Tes données actuelles seront remplacées.")) return;
      seed(); U().renderSettings(); U().go('dashboard'); U().renderChatHistory();
      U().toast('Jeu de démonstration chargé. Remplace-le par tes vraies données.', 'ok');
    });
    $('#btnWipe').addEventListener('click', () => {
      if (!confirm('Effacer définitivement toutes tes données ? Cette action est irréversible.')) return;
      if (!confirm('Confirme une seconde fois : tout sera perdu.')) return;
      G.Store.wipe(); location.reload();
    });
  }

  /* ---------------------------------------------------------------- chat */
  function wireChat() {
    $('#chatForm').addEventListener('submit', e => { e.preventDefault(); send($('#chatText').value.trim()); });
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-q]'); if (!b) return;
      U().go('agent');
      setTimeout(() => send(b.dataset.q), 60);
    });

    async function send(text) {
      if (!text) return;
      $('#chatText').value = '';
      U().addMsg('user', U().esc(text));
      G.Store.state.chat.push({ role: 'user', text }); G.Store.save();
      U().addTyping('Analyse de ton portefeuille…');
      try {
        const r = await G.Agent.ask(text, {
          history: G.Store.state.chat.slice(0, -1),
          onProgress: (i, n, t) => U().setTypingNote(`Analyse ${i}/${n} — ${t}…`)
        });
        U().removeTyping();
        U().addMsg('ai', U().md(r.text));
        G.Store.state.chat.push({ role: 'assistant', text: r.text });
        if (G.Store.state.chat.length > 60) G.Store.state.chat = G.Store.state.chat.slice(-60);
        G.Store.save();
      } catch (err) {
        U().removeTyping();
        U().addMsg('ai', U().md(`Une erreur est survenue : ${err.message}`));
      }
    }
  }

  /* --------------------------------------------------------------- modale */
  function wireModal() {
    $('#modalClose').addEventListener('click', U().closeModal);
    $('#modalBackdrop').addEventListener('mousedown', e => { if (e.target.id === 'modalBackdrop') U().closeModal(); });
    $('#modalFoot').addEventListener('click', e => {
      const b = e.target.closest('[data-modal]'); if (!b) return;
      if (b.dataset.modal === 'cancel') return U().closeModal();
      const fn = U().modalOnSave;
      if (fn && fn() === false) return;      // validation échouée : on garde la modale
      U().closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('#modalBackdrop').hidden) U().closeModal();
      if (e.key === 'Enter' && !$('#modalBackdrop').hidden && e.target.tagName === 'INPUT') {
        const fn = U().modalOnSave;
        if (fn && fn() === false) return;
        U().closeModal();
      }
    });
  }

  /* ------------------------------------------------------- jeu de démo */
  function seed() {
    G.Store.wipe();
    const s = G.Store.state;
    s.profile.riskProfile = 'equilibre';
    s.profile.horizonYears = 10;
    s.profile.monthlyBudget = 150;
    s.profile.availableCash = 500;
    s.profile.target = Object.assign({}, G.DATA.PROFILES.equilibre.target);

    G.Store.addHolding({ type:'etf', ticker:'IWDA', catalogId:'IWDA', name:'iShares Core MSCI World', isin:'IE00B4L5Y983', quantity: 22, avgPrice: 92.4, account:'CTO', currency:'EUR' });
    G.Store.addHolding({ type:'etf', ticker:'MEUD', catalogId:'MEUD', name:'Amundi Core STOXX Europe 600', isin:'LU0908500753', quantity: 6, avgPrice: 208.0, account:'PEA', currency:'EUR' });
    G.Store.addHolding({ type:'action', ticker:'AAPL', name:'Apple', quantity: 4, avgPrice: 178.5, account:'CTO', currency:'USD', sector:'Technologie', region:'États-Unis' });
    G.Store.addHolding({ type:'action', ticker:'MC.PA', name:'LVMH', quantity: 1, avgPrice: 640.0, account:'PEA', currency:'EUR', sector:'Conso. discrétionnaire', region:'France' });

    G.Store.addCash({ label:'Livret A', amount: 1800, rate: 2.4 });

    G.Store.addBrick({ name:'Résidence Les Tilleuls — Nantes', amount: 500, yieldPct: 9.0, durationMonths: 24,
      location:'Nantes (44)', projectType:'Marchand de biens', promoter:'Atlantique Promotion', promoterTrack: 7,
      ltv: 68, guarantees:'Hypothèque de 1er rang', status:'en cours' });
    G.Store.addBrick({ name:'Opération Bellevue — Montpellier', amount: 0, yieldPct: 12.5, durationMonths: 36,
      location:'Montpellier (34)', projectType:'Promotion neuve', promoter:'Sud Développement', promoterTrack: 4,
      ltv: 82, guarantees:'Caution personnelle du dirigeant', status:'candidat' });
    G.Store.addBrick({ name:'Réhabilitation Gare — Lille', amount: 0, yieldPct: 8.0, durationMonths: 18,
      location:'Lille (59)', projectType:'Rénovation', promoter:'Nord Rénov', promoterTrack: 8,
      ltv: 58, guarantees:'Hypothèque de 1er rang + fiducie', status:'candidat' });

    G.Store.addWatch({ ticker:'MSFT', name:'Microsoft' });
    G.Store.addWatch({ ticker:'NVDA', name:'NVIDIA' });
    G.Store.addWatch({ ticker:'ASML', name:'ASML' });

    // historique de versements sur 12 mois
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 5);
      const iso = G.Store.localISO(d);
      const amt = 130 + Math.round(((i * 37) % 60));
      G.Store.addTransaction({ date: iso, kind:'buy', ticker:'IWDA', label:'iShares Core MSCI World',
        quantity: +(amt / 95).toFixed(4), price: 95, amount: amt, fees: 1 });
    }
    G.Store.addTransaction({ date: G.Store.todayISO(), kind:'dividend', ticker:'MC.PA', label:'LVMH', amount: 13 });
    G.Store.save();
  }

  G.App = { seed };
})(window);
