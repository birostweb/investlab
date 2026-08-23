/* ============================================================================
   ui.js — Rendu de l'interface
   ========================================================================== */
(function (G) {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const has = v => v !== null && v !== undefined && isFinite(v);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const eur = (v, d) => has(v) ? new Intl.NumberFormat('fr-FR', { style:'currency', currency:'EUR', maximumFractionDigits: d === undefined ? 0 : d }).format(v) : '—';
  const eur2 = v => eur(v, 2);
  const pctS = (v, d) => has(v) ? (v >= 0 ? '+' : '') + v.toFixed(d === undefined ? 2 : d) + ' %' : '—';
  const pctA = (v, d) => has(v) ? v.toFixed(d === undefined ? 1 : d) + ' %' : '—';
  const scoreCls = s => !has(s) ? '' : s >= 75 ? 'score-g' : s >= 60 ? 'score-b' : s >= 45 ? 'score-a' : 'score-r';

  /* ============================================================ MARKDOWN → HTML */
  /* Rendu volontairement minimal : gras, italique, listes, tableaux, titres.
     Le HTML déjà présent (badges de confiance, spans) est conservé tel quel.  */
  function md(src) {
    const lines = String(src).split('\n');
    let out = '', inUl = false, inOl = false, inTable = false;
    const closeLists = () => { if (inUl) { out += '</ul>'; inUl = false; } if (inOl) { out += '</ol>'; inOl = false; } };
    const closeTable = () => { if (inTable) { out += '</tbody></table>'; inTable = false; } };
    const inline = t => t
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<i>$2</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const t = l.trim();
      if (/^\|.*\|$/.test(t)) {
        const cells = t.slice(1, -1).split('|').map(c => c.trim());
        if (/^[-: ]+$/.test(cells.join(''))) continue;             // ligne de séparation
        if (!inTable) {
          closeLists();
          out += '<table><thead><tr>' + cells.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
          inTable = true;
        } else {
          out += '<tr>' + cells.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
        }
        continue;
      }
      closeTable();
      if (/^####\s+/.test(t)) { closeLists(); out += `<h4>${inline(t.replace(/^####\s+/, ''))}</h4>`; continue; }
      if (/^###\s+/.test(t)) { closeLists(); out += `<h4>${inline(t.replace(/^###\s+/, ''))}</h4>`; continue; }
      if (/^---+$/.test(t)) { closeLists(); out += '<hr>'; continue; }
      const ol = t.match(/^(\d+)\.\s+(.*)$/);
      if (ol) { if (inUl) { out += '</ul>'; inUl = false; } if (!inOl) { out += '<ol>'; inOl = true; } out += `<li>${inline(ol[2])}</li>`; continue; }
      const ul = t.match(/^[-*]\s+(.*)$/);
      if (ul) { if (inOl) { out += '</ol>'; inOl = false; } if (!inUl) { out += '<ul>'; inUl = true; } out += `<li>${inline(ul[1])}</li>`; continue; }
      if (!t) { closeLists(); continue; }
      closeLists();
      out += /^</.test(t) ? t : `<p>${inline(t)}</p>`;
    }
    closeLists(); closeTable();
    return out;
  }

  /* ================================================================= TOAST */
  let toastT;
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg; el.className = 'toast ' + (kind || '');
    el.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => el.hidden = true, kind === 'err' ? 6000 : 3200);
  }

  /* ================================================================= MODALE */
  let modalOnSave = null;
  /** opts.wide : modale large (tableaux). opts.noSave : le pied ne propose que
   *  « Fermer » — la modale pilote elle-même ses propres boutons. */
  function openModal(title, bodyHTML, footHTML, onSave, opts) {
    opts = opts || {};
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHTML;
    $('#modalFoot').innerHTML = footHTML !== null && footHTML !== undefined ? footHTML
      : opts.noSave ? `<button class="btn ghost" data-modal="cancel">Fermer</button>`
      : `<button class="btn ghost" data-modal="cancel">Annuler</button><button class="btn primary" data-modal="save">Enregistrer</button>`;
    $('#modalBackdrop').hidden = false;
    $('#modalBackdrop').classList.toggle('wide', !!opts.wide);
    modalOnSave = onSave || null;
    const first = $('#modalBody input,#modalBody select'); if (first) setTimeout(() => first.focus(), 40);
  }
  /** Remplace le contenu d'une modale déjà ouverte (parcours en plusieurs étapes). */
  function setModalBody(title, bodyHTML) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHTML;
  }
  function closeModal() {
    $('#modalBackdrop').hidden = true;
    $('#modalBackdrop').classList.remove('wide');
    modalOnSave = null;
  }
  function modalValues() {
    const o = {};
    $$('#modalBody [data-f]').forEach(el => {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.dataset.num !== undefined && el.type !== 'checkbox') v = v === '' ? null : Number(String(v).replace(',', '.'));
      o[el.dataset.f] = v;
    });
    return o;
  }
  const field = (f, label, opts) => {
    opts = opts || {};
    const v = opts.value === null || opts.value === undefined ? '' : opts.value;
    if (opts.type === 'select') {
      return `<label class="${opts.full ? 'full' : ''}">${esc(label)}
        <select class="input" data-f="${f}">${opts.options.map(o =>
          `<option value="${esc(o.v)}" ${String(o.v) === String(v) ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select></label>`;
    }
    if (opts.type === 'checkbox') {
      return `<label class="${opts.full ? 'full' : ''}" style="flex-direction:row;align-items:center;gap:8px">
        <input type="checkbox" data-f="${f}" ${v ? 'checked' : ''} style="width:auto"> ${esc(label)}</label>`;
    }
    return `<label class="${opts.full ? 'full' : ''}">${esc(label)}
      <input class="input" data-f="${f}" ${opts.type === 'number' ? 'type="number" data-num step="any"' : opts.type === 'date' ? 'type="date"' : ''}
        value="${esc(v)}" placeholder="${esc(opts.ph || '')}"></label>`;
  };

  /* ============================================================== NAVIGATION */
  const TITLES = {
    dashboard: ['Mon patrimoine', "Vue d'ensemble consolidée"],
    agent: ['InvestAI', 'Ton analyste personnel — il connaît ton portefeuille'],
    portfolio: ['Portefeuille', 'Positions, expositions et mouvements'],
    etf: ['ETF', "Moteur de comparaison et de classement"],
    stocks: ['Actions', 'Analyse fondamentale et valorisation'],
    realestate: ['Immobilier', 'Immobilier participatif — rendement et risque'],
    opportunities: ['Opportunités', 'Meilleur rapport qualité / risque / valorisation'],
    plan: ['Mon plan', 'Répartition dynamique et rééquilibrage'],
    simulator: ['Simulateur', 'Scénarios de projection du patrimoine'],
    journal: ['Journal', 'Traçabilité et relecture des décisions'],
    settings: ['Réglages', 'Profil, allocation cible, sources de données']
  };
  function go(view) {
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $$('.view').forEach(s => s.classList.toggle('active', s.dataset.view === view));
    const t = TITLES[view] || ['', ''];
    $('#viewTitle').textContent = t[0]; $('#viewSub').textContent = t[1];
    window.scrollTo({ top: 0 });
    if (view === 'dashboard') renderDashboard();
    if (view === 'portfolio') renderPortfolio();
    if (view === 'realestate') renderBricksList();
    if (view === 'journal') renderJournal();
    if (view === 'stocks') renderWatchlist();
    if (view === 'settings') renderSettings();
  }

  /* =============================================================== DASHBOARD */
  function renderDashboard() {
    const s = G.Store.snapshot();
    const st = G.Store.state;
    $('#heroTotal').textContent = eur(s.total);
    const perf = $('#heroPerf');
    perf.textContent = pctS(s.plPct, 1);
    perf.className = 'pill' + (s.plPct < 0 ? ' neg' : '');
    // on ne laisse jamais croire que la plus-value couvre tout le portefeuille
    $('#heroPl').textContent = s.unpriced.length
      ? `${s.pl >= 0 ? '+' : ''}${eur(s.pl)} sur ${pctA(s.plCoverage)} du portefeuille — ` +
        `${s.unpriced.length} ligne(s) sans prix de revient`
      : `${s.pl >= 0 ? '+' : ''}${eur(s.pl)} de plus-value latente`;
    $('#statMonth').textContent = eur(G.Store.investedInMonth());
    $('#statCrypto').textContent = eur(s.cryptoValue);
    const y = G.Store.currentYield(s);
    $('#statIncome').textContent = eur(y.realised);
    $('#statYield').textContent = pctA(y.pct);
    const st2 = $('#statYield').parentElement.querySelector('span');
    if (st2) st2.textContent = y.expectedStaking > 0
      ? 'Rendement courant (dont staking)' : 'Rendement courant';

    // allocation
    const A = G.DATA.ASSET_COLORS;
    const data = [
      { label: 'ETF', value: s.etfValue, color: A.etf, target: s.target.etf },
      { label: 'Actions', value: s.stockValue, color: A.actions, target: s.target.actions },
      { label: 'Crypto', value: s.cryptoValue, color: A.crypto, target: s.target.crypto },
      { label: 'Immobilier', value: s.bricksValue, color: A.immobilier, target: s.target.immobilier }
    ];
    G.Charts.donut($('#allocDonut'), data, { center: { top: eur(s.total), bottom: 'patrimoine' } });
    $('#allocLegend').innerHTML = data.map(d => {
      const p = s.total ? d.value / s.total * 100 : 0;
      return `<div class="legend-row"><span class="sw" style="background:${d.color}"></span>
        <span class="nm">${d.label}</span><span class="vl">${pctA(p)}</span>
        <span class="tg">cible ${d.target} %</span></div>`;
    }).join('');
    const maxGap = Math.max(...data.map(d => Math.abs((s.total ? d.value / s.total * 100 : 0) - d.target)));
    $('#allocDrift').textContent = s.total ? (maxGap < 5 ? 'proche de la cible' : `écart max ${maxGap.toFixed(1)} pts`) : '';

    G.Charts.targetBars($('#allocBars'), data.map(d => ({
      label: d.label, actual: s.total ? d.value / s.total * 100 : 0, target: d.target, color: d.color
    })));

    // top positions
    const rows = s.holdings.map(h => ({ nm: h.name || h.ticker, v: h._value, t: h.type }))
      .concat(st.bricks.filter(b => b.status !== 'remboursé' && b.status !== 'perdu')
        .map(b => ({ nm: b.name || 'Projet immobilier', v: Number(b.amount) || 0, t: 'immo' })))
      .filter(r => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 6);
    const maxV = rows.length ? rows[0].v : 0;
    $('#topPositions').innerHTML = rows.length ? rows.map(r => {
      const w = s.total ? r.v / s.total * 100 : 0;
      const col = r.t === 'etf' ? A.etf : r.t === 'action' ? A.actions : A.immobilier;
      return `<div class="mini-row"><span class="nm">${esc(r.nm)}</span>
        <span class="track"><i style="width:${maxV ? Math.min(100, r.v / maxV * 100) : 0}%;background:${col}"></i></span>
        <span class="wt">${pctA(w)}</span></div>`;
    }).join('') : `<div class="empty">Aucune position. Ajoute tes lignes dans <b>Portefeuille</b>.</div>`;

    G.Charts.monthlyBars($('#monthlyChart'), G.Store.monthlySeries(12));

    // profil + santé des données
    const prof = G.DATA.PROFILES[st.profile.riskProfile] || G.DATA.PROFILES.equilibre;
    $('#chipProfile').textContent = prof.label;
    $('#chipHorizon').textContent = `Horizon ${st.profile.horizonYears} ans`;
    const ps = G.Market.providerStatus();
    $('#dataHealth').innerHTML = ps.map(p =>
      `<div>${p.on ? '<span style="color:var(--pos)">●</span>' : '<span style="color:var(--ink-4)">○</span>'} ${esc(p.name)}</div>`).join('') +
      (st.settings.lastRefresh ? `<div style="margin-top:5px">MAJ ${new Date(st.settings.lastRefresh).toLocaleString('fr-FR', { dateStyle:'short', timeStyle:'short' })}</div>` : '');

    // brief
    $('#briefDate').textContent = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
    G.Agent.dailyBrief().then(t => { $('#dailyBrief').innerHTML = t; });
  }

  const TYPE_LBL = { etf: 'ETF', action: 'Action', crypto: 'Crypto' };
  const TYPE_CLS = { etf: 'etf', action: 'action', crypto: 'crypto' };

  /* =============================================================== PORTFOLIO */
  function renderPortfolio() {
    const s = G.Store.snapshot();
    const st = G.Store.state;

    const rows = s.holdings.map(h => {
      const cat = G.Store.findCatalog(h.catalogId || h.ticker || h.isin);
      return `<tr data-hid="${h.id}">
        <td><span class="tag ${TYPE_CLS[h.type] || 'action'}">${TYPE_LBL[h.type] || 'Action'}</span></td>
        <td><span class="tick">${esc(h.ticker || '—')}</span><span class="sub">${esc(h.name || (cat ? cat.name : ''))}</span></td>
        <td>${esc(h.account)}${cat && cat.pea ? ' <span class="tag pea">PEA</span>' : ''}${
          Number(h.stakingPct) > 0 ? ` <span class="tag stake" title="Immobilisé${h.stakingUntil ? " jusqu'au " + esc(h.stakingUntil) : ''}">🔒 ${h.stakingPct} %</span>` : ''}</td>
        <td class="num">${has(h.quantity) ? h.quantity.toLocaleString('fr-FR', { maximumFractionDigits: 4 }) : '—'}</td>
        <td class="num">${eur2(h.avgPrice)}</td>
        <td class="num">${h._live ? eur2(h._price) : `<span class="muted">${eur2(h._price)}</span>`}
          <span class="sub">${h._live ? esc(h._priceSource) + ' · ' + esc(h._priceDate || '') : 'prix de revient'}</span></td>
        <td class="num"><b>${eur(h._value)}</b><span class="sub">${pctA(s.total ? h._value / s.total * 100 : 0)} du total</span></td>
        <td class="num ${h._pl >= 0 ? 'pos' : 'neg'}">${eur(h._pl)}<span class="sub ${h._pl >= 0 ? 'pos' : 'neg'}">${pctS(h._plPct, 1)}</span></td>
        <td class="num"><button class="icon-btn" data-act="edit-h" data-id="${h.id}">✎</button>
          <button class="icon-btn" data-act="del-h" data-id="${h.id}">✕</button></td>
      </tr>`;
    }).join('');

    $('#holdingsTable').innerHTML = rows
      ? `<table class="tbl"><thead><tr>
          <th>Type</th><th>Actif</th><th>Compte</th><th class="num">Qté</th><th class="num">PRU</th>
          <th class="num">Cours</th><th class="num">Valeur</th><th class="num">+/- value</th><th></th>
        </tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty">Aucune position enregistrée.<br>
         Clique sur <b>+ Position</b>, ou sur <b>⤢ Importer une photo</b> pour laisser InvestAI lire tes captures d'écran.</div>`;

    const exp = G.Engine.exposures(s);
    G.Charts.expoBars($('#geoExposure'), exp.geo);
    G.Charts.expoBars($('#sectorExposure'), exp.sector);

    const KIND = { buy:'Achat', sell:'Vente', dividend:'Dividende', interest:'Intérêts', deposit:'Versement', rent:'Loyer' };
    const tx = st.transactions.slice(0, 40).map(t => `<tr>
      <td>${esc(t.date)}</td>
      <td><span class="tag">${esc(KIND[t.kind] || t.kind)}</span></td>
      <td><span class="tick">${esc(t.ticker || t.label || '—')}</span></td>
      <td class="num">${t.quantity ? t.quantity.toLocaleString('fr-FR', { maximumFractionDigits:4 }) : '—'}</td>
      <td class="num">${t.price ? eur2(t.price) : '—'}</td>
      <td class="num"><b>${eur2(t.amount)}</b></td>
      <td class="num">${t.fees ? eur2(t.fees) : '—'}</td>
      <td class="num"><button class="icon-btn" data-act="del-tx" data-id="${t.id}">✕</button></td>
    </tr>`).join('');
    $('#txTable').innerHTML = tx
      ? `<table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Actif</th><th class="num">Qté</th><th class="num">Prix</th><th class="num">Montant</th><th class="num">Frais</th><th></th></tr></thead><tbody>${tx}</tbody></table>`
      : `<div class="empty">Aucun mouvement. Saisis tes achats pour suivre tes investissements mensuels.</div>`;
  }

  /* ============================================================ FORMULAIRES */
  function holdingModal(id) {
    const h = id ? G.Store.state.holdings.find(x => x.id === id) : null;
    const cats = G.Store.etfCatalog();
    const body = `<div class="field-grid">
      ${field('type', 'Type', { type:'select', value: h ? h.type : 'etf', options:[{v:'etf',l:'ETF'},{v:'action',l:'Action'},{v:'crypto',l:'Crypto'}] })}
      ${field('account', 'Compte / plateforme', { type:'select', value: h ? h.account : 'CTO', options:[
        {v:'PEA',l:'PEA'},{v:'CTO',l:'Compte-titres'},{v:'AV',l:'Assurance-vie'},{v:'PER',l:'PER'},
        {v:'Binance',l:'Binance'},{v:'Bitstack',l:'Bitstack'},{v:'Crypto.com',l:'Crypto.com'},
        {v:'Coinbase',l:'Coinbase'},{v:'Kraken',l:'Kraken'},{v:'Ledger',l:'Ledger (auto-garde)'},{v:'Autre',l:'Autre'}] })}
      ${field('catalogId', 'ETF du catalogue (facultatif)', { type:'select', full:true, value: h ? h.catalogId : '',
        options: [{ v:'', l:'— aucun / action —' }].concat(cats.map(c => ({ v:c.id, l:`${c.name} (${c.ticker})` }))) })}
      ${field('ticker', 'Ticker', { value: h ? h.ticker : '', ph:'AAPL, IWDA, BTC…' })}
      ${field('name', 'Nom', { value: h ? h.name : '' })}
      ${field('quantity', 'Quantité', { type:'number', value: h ? h.quantity : '', ph:'0,0345 pour une fraction' })}
      ${field('avgPrice', "Prix de revient unitaire (€)", { type:'number', value: h ? h.avgPrice : '' })}
      ${field('sector', 'Secteur (actions)', { type:'select', value: h ? h.sector : '',
        options: [{v:'',l:'—'}].concat(['Technologie','Finance','Santé','Industrie','Conso. discrétionnaire','Conso. de base','Énergie','Communication','Services publics','Matériaux','Immobilier'].map(x => ({v:x,l:x}))) })}
      ${field('region', 'Région (actions)', { type:'select', value: h ? h.region : '',
        options: [{v:'',l:'—'}].concat(['États-Unis','France','Europe hors RU','Royaume-Uni','Japon','Asie-Pacifique','Émergents','Chine'].map(x => ({v:x,l:x}))) })}
      ${field('currency', 'Devise', { type:'select', value: h ? h.currency : 'EUR', options:[{v:'EUR',l:'EUR'},{v:'USD',l:'USD'},{v:'GBP',l:'GBP'},{v:'CHF',l:'CHF'}] })}
      ${field('stakingPct', 'Staking — rendement annoncé (%/an)', { type:'number', value: h ? h.stakingPct : '', ph:'11.44' })}
      ${field('stakingUntil', 'Staking — immobilisé jusqu\'au', { type:'date', value: h ? h.stakingUntil : '' })}
    </div>
    <p class="note" style="margin-top:14px">Le ticker sert à récupérer le cours réel. Si tu rattaches un ETF au catalogue, sa composition (indice, frais, géographie, secteurs) alimente l'analyse de diversification.
    Pour une crypto, saisis simplement son symbole (<code>BTC</code>, <code>ETH</code>, <code>SOL</code>…) : les cours viennent de CoinGecko, sans clé d'API. Les quantités fractionnaires sont acceptées.</p>`;
    openModal(id ? 'Modifier la position' : 'Nouvelle position', body, null, () => {
      const v = modalValues();
      if (!v.ticker && !v.name) { toast('Renseigne au moins un ticker ou un nom.', 'err'); return false; }
      if (v.catalogId) {
        const c = G.Store.findCatalog(v.catalogId);
        if (c) { if (!v.ticker) v.ticker = c.ticker; if (!v.name) v.name = c.name; v.isin = c.isin; }
      }
      if (id) G.Store.updateHolding(id, v); else G.Store.addHolding(v);
      toast('Position enregistrée.', 'ok');
      renderPortfolio(); renderDashboard();
    });
  }

  function txModal() {
    const hs = G.Store.state.holdings;
    const body = `<div class="field-grid">
      ${field('date', 'Date', { type:'date', value: G.Store.todayISO() })}
      ${field('kind', 'Type', { type:'select', value:'buy', options:[
        {v:'buy',l:'Achat'},{v:'sell',l:'Vente'},{v:'dividend',l:'Dividende'},
        {v:'interest',l:'Intérêts'},{v:'rent',l:'Loyer / coupon immobilier'},{v:'deposit',l:'Versement sur le compte'}] })}
      ${field('holdingId', 'Position liée', { type:'select', full:true, value:'',
        options: [{v:'',l:'— aucune —'}].concat(hs.map(h => ({ v:h.id, l:`${h.ticker || ''} ${h.name || ''}`.trim() }))) })}
      ${field('quantity', 'Quantité', { type:'number' })}
      ${field('price', 'Prix unitaire (€)', { type:'number' })}
      ${field('amount', 'Montant total (€)', { type:'number' })}
      ${field('fees', 'Frais (€)', { type:'number' })}
      ${field('note', 'Note', { full:true })}
    </div>
    <p class="note" style="margin-top:14px">Si tu laisses le montant vide, il est calculé automatiquement (quantité × prix). Un achat lié à une position met à jour sa quantité et son prix de revient.</p>`;
    openModal('Nouveau mouvement', body, null, () => {
      const v = modalValues();
      if (v.holdingId) {
        const h = G.Store.state.holdings.find(x => x.id === v.holdingId);
        if (h) { v.ticker = h.ticker; v.label = h.name; }
      }
      if (!v.amount && v.quantity && v.price) v.amount = v.quantity * v.price;
      if (!v.amount) { toast('Renseigne un montant, ou une quantité et un prix.', 'err'); return false; }
      const t = G.Store.addTransaction(v);
      // mise à jour de la position (prix de revient moyen)
      if (t.holdingId && (t.kind === 'buy' || t.kind === 'sell')) {
        const h = G.Store.state.holdings.find(x => x.id === t.holdingId);
        if (h && t.quantity) {
          if (t.kind === 'buy') {
            const newQty = (Number(h.quantity) || 0) + t.quantity;
            const newCost = (Number(h.quantity) || 0) * (Number(h.avgPrice) || 0) + t.quantity * t.price;
            G.Store.updateHolding(h.id, { quantity: newQty, avgPrice: newQty ? newCost / newQty : 0 });
          } else {
            G.Store.updateHolding(h.id, { quantity: Math.max(0, (Number(h.quantity) || 0) - t.quantity) });
          }
        }
      }
      toast('Mouvement enregistré.', 'ok');
      renderPortfolio(); renderDashboard();
    });
  }

  function brickModal(id) {
    const b = id ? G.Store.state.bricks.find(x => x.id === id) : null;
    const body = `<div class="field-grid">
      ${field('name', 'Nom du projet', { full:true, value: b ? b.name : '' })}
      ${field('platform', 'Plateforme', { value: b ? b.platform : 'Bricks' })}
      ${field('status', 'Statut', { type:'select', value: b ? b.status : 'candidat', options:[
        {v:'candidat',l:'Candidat (à analyser)'},{v:'en cours',l:'Investi — en cours'},
        {v:'en retard',l:'En retard'},{v:'remboursé',l:'Remboursé'},{v:'perdu',l:'Perte constatée'}] })}
      ${field('amount', 'Montant investi (€)', { type:'number', value: b ? b.amount : '' })}
      ${field('yieldPct', 'Rendement annoncé (%/an)', { type:'number', value: b ? b.yieldPct : '' })}
      ${field('durationMonths', 'Durée (mois)', { type:'number', value: b ? b.durationMonths : '' })}
      ${field('startDate', 'Date de départ', { type:'date', value: b ? b.startDate : G.Store.todayISO() })}
      ${field('location', 'Localisation', { value: b ? b.location : '' })}
      ${field('projectType', 'Type de projet', { type:'select', value: b ? b.projectType : '', options:
        [{v:'',l:'—'}].concat(['Marchand de biens','Promotion neuve','Rénovation','Aménagement foncier','Locatif','Autre'].map(x => ({v:x,l:x}))) })}
      ${field('promoter', 'Promoteur / porteur', { value: b ? b.promoter : '' })}
      ${field('promoterTrack', 'Note historique promoteur (0-10)', { type:'number', value: b ? b.promoterTrack : '' })}
      ${field('ltv', "Ratio d'endettement LTV (%)", { type:'number', value: b ? b.ltv : '' })}
      ${field('guarantees', 'Garanties', { full:true, value: b ? b.guarantees : '', ph:'hypothèque de 1er rang, caution, fiducie…' })}
      ${field('delayed', 'Projet déjà en retard', { type:'checkbox', full:true, value: b ? b.delayed : false })}
      ${field('notes', 'Notes', { full:true, value: b ? b.notes : '' })}
    </div>
    <p class="note" style="margin-top:14px">Plus tu renseignes de champs (garanties, promoteur, LTV), plus le niveau de confiance de l'analyse sera élevé. Les champs vides font <b>baisser</b> la confiance — ils ne sont jamais devinés.</p>`;
    openModal(id ? 'Modifier le projet' : 'Nouveau projet immobilier', body, null, () => {
      const v = modalValues();
      if (!v.name) { toast('Donne un nom au projet.', 'err'); return false; }
      if (id) G.Store.updateBrick(id, v); else G.Store.addBrick(v);
      toast('Projet enregistré.', 'ok'); renderBricksList(); renderDashboard();
    });
  }

  function etfModal() {
    const body = `<div class="field-grid">
      ${field('id', 'Identifiant court', { value:'', ph:'ex : MEUD' })}
      ${field('ticker', 'Ticker', { value:'' })}
      ${field('name', 'Nom complet', { full:true, value:'' })}
      ${field('isin', 'ISIN', { value:'' })}
      ${field('index', 'Indice suivi', { value:'' })}
      ${field('ter', 'Frais courants TER (%/an)', { type:'number', value:'' })}
      ${field('aum', 'Encours (M€)', { type:'number', value:'' })}
      ${field('holdings', 'Nombre de positions', { type:'number', value:'' })}
      ${field('incepted', 'Année de création', { type:'number', value:'' })}
      ${field('currency', 'Devise', { type:'select', value:'EUR', options:[{v:'EUR',l:'EUR'},{v:'USD',l:'USD'}] })}
      ${field('replication', 'Réplication', { type:'select', value:'Physique', options:[{v:'Physique',l:'Physique'},{v:'Synthétique (swap)',l:'Synthétique (swap)'}] })}
      ${field('dist', 'Distribution', { type:'select', value:'Capitalisant', options:[{v:'Capitalisant',l:'Capitalisant'},{v:'Distribuant',l:'Distribuant'}] })}
      ${field('pea', 'Éligible PEA', { type:'checkbox', full:true, value:false })}
    </div>
    <p class="note" style="margin-top:14px">Reprends ces informations du <b>DIC/KID officiel</b> de l'émetteur. L'application les marquera comme non vérifiées et en tiendra compte dans le niveau de confiance.</p>`;
    openModal('Ajouter un ETF au catalogue', body, null, () => {
      const v = modalValues();
      if (!v.id || !v.name) { toast('Identifiant et nom sont requis.', 'err'); return false; }
      v.type = 'etf'; v.verified = false; v.asOf = G.Store.todayISO();
      v.source = 'Saisie manuelle'; v.geo = {}; v.sector = {};
      G.Store.state.etfExtra.push(v); G.Store.save();
      toast('ETF ajouté au catalogue.', 'ok');
    });
  }

  /* ================================================================= ETF VIEW */
  async function renderEtfRanking(filter) {
    const el = $('#etfRanking');
    el.innerHTML = `<div class="empty">Analyse en cours — récupération des historiques de prix…</div>`;
    const { ranked, ctx } = await G.Engine.rankEtfs(filter);
    el.innerHTML = ranked.map((r, i) => etfCard(r, i, ctx)).join('');
  }
  function etfCard(r, i, ctx) {
    const c = r.cat;
    const comps = r.components.filter(x => has(x.v));
    return `<div class="rank-card ${i < 3 ? 'top' : ''}">
      <div class="rank-head">
        <div class="rank-no">${i + 1}</div>
        <div class="rank-title"><strong>${esc(c.name)}</strong>
          <span class="sub">${esc(c.index)} · ${esc(c.ticker)} · ${esc(c.isin)} · ${esc(c.dist)} · ${esc(c.replication)}${c.pea ? ' · <b style="color:var(--pos)">PEA</b>' : ''}</span></div>
        <div class="score-badge"><div class="v ${scoreCls(r.score)}">${has(r.score) ? r.score : '—'}</div><div class="l">/100</div></div>
      </div>
      <div class="subscores">${comps.map(x =>
        `<div class="subscore"><span class="k">${esc(x.k)}</span><span class="v">${x.v.toFixed(1)}/10</span></div>`).join('')}</div>
      <div class="kv">
        <div><span class="k">Frais</span><span class="v">${has(c.ter) ? c.ter + ' %' : '—'}</span></div>
        <div><span class="k">Positions</span><span class="v">${has(c.holdings) ? c.holdings.toLocaleString('fr-FR') : '—'}</span></div>
        <div><span class="k">Encours</span><span class="v">${has(c.aum) ? c.aum.toLocaleString('fr-FR') + ' M€' : '—'}</span></div>
        <div><span class="k">Créé en</span><span class="v">${c.incepted || '—'}</span></div>
        ${r.stats ? `<div><span class="k">Volatilité</span><span class="v">${pctA(r.stats.vol)}</span></div>
        <div><span class="k">Pire baisse</span><span class="v">${pctA(r.stats.maxDD)}</span></div>
        <div><span class="k">Annualisé</span><span class="v">${pctA(r.stats.cagr)}</span></div>` : ''}
      </div>
      <div class="rank-body">
        <h5>Pourquoi il est intéressant</h5>
        <ul>${(c.note ? [`<li>${esc(c.note)}</li>`] : []).concat(
          has(c.ter) ? [`<li>Frais de <b>${c.ter} %/an</b>${c.ter <= 0.15 ? ' — très bas' : ''}.</li>`] : [],
          has(c.holdings) ? [`<li><b>${c.holdings.toLocaleString('fr-FR')}</b> positions sur ${esc(c.index)}.</li>`] : [],
          r.stats ? [`<li>Mesuré sur ${r.stats.years.toFixed(1)} ans : volatilité ${pctA(r.stats.vol)}, pire baisse ${pctA(r.stats.maxDD)}. <span class="muted">(${esc(r.stats.source)}, ${esc(r.stats.asOf)})</span></li>`]
                   : [`<li class="muted">Historique de prix indisponible : le score repose sur les caractéristiques structurelles uniquement.</li>`]
        ).join('')}</ul>
        <h5>Risques</h5>
        <ul>${riskItems(c, r).map(x => `<li>${x}</li>`).join('')}</ul>
        <h5>Place dans ton portefeuille</h5>
        <ul>${(r.fit.reasons.length ? r.fit.reasons : ['Aucun élément distinctif.']).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>
      ${confHTML(r.confidence)}
      <div class="sources"><span>· Fiche : <b>${esc(c.source)}</b> — ${esc(c.asOf)}${!c.verified ? ' · <b style="color:var(--warn)">à vérifier sur le DIC de l\'émetteur</b>' : ''}</span>
      ${r.stats ? `<span>· Historique : <b>${esc(r.stats.source)}</b> — ${esc(r.stats.asOf)}</span>` : ''}</div>
    </div>`;
  }
  function riskItems(c, r) {
    const out = [];
    if (/synth/i.test(c.replication)) out.push('Réplication <b>synthétique</b> : risque de contrepartie sur le swap.');
    if (c.currency && c.currency !== 'EUR') out.push(`Fonds libellé en <b>${esc(c.currency)}</b> : risque de change non couvert.`);
    if (has(c.holdings) && c.holdings < 120) out.push(`Seulement <b>${c.holdings}</b> lignes : concentration notable.`);
    const ts = Object.entries(c.sector || {}).sort((a, b) => b[1] - a[1])[0];
    if (ts && ts[1] > 35) out.push(`${esc(ts[0])} pèse <b>${ts[1]} %</b> de l'indice.`);
    const tg = Object.entries(c.geo || {}).sort((a, b) => b[1] - a[1])[0];
    if (tg && tg[1] > 65) out.push(`${esc(tg[0])} pèse <b>${tg[1]} %</b> : forte dépendance à une seule zone.`);
    if (r.stats && has(r.stats.maxDD) && Math.abs(r.stats.maxDD) > 30) out.push(`A déjà connu une baisse de <b>${pctA(r.stats.maxDD)}</b> sur la période observée.`);
    if (has(c.aum) && c.aum < 200) out.push('Encours faible : risque de fermeture ou de fusion du fonds.');
    if (!out.length) out.push('Pas de risque structurel saillant. Le risque de marché, lui, reste entier.');
    return out;
  }
  function confHTML(c) {
    if (!c) return '';
    const col = c.score >= 70 ? 'var(--pos)' : c.score >= 45 ? 'var(--warn)' : 'var(--neg)';
    return `<div class="confidence">
      <span class="conf-txt">Confiance <b style="color:${col}">${c.score}/100</b></span>
      <span class="conf-bar"><i style="width:${c.score}%;background:${col}"></i></span>
      <span class="conf-txt">${esc(c.reasons[0])}</span></div>`;
  }

  /* ============================================================= ACTIONS VIEW */
  async function analyseStock(ticker) {
    const el = $('#stockResults');
    if (!ticker) { toast('Saisis un ticker.', 'err'); return; }
    if (!G.Market.hasProvider()) {
      el.innerHTML = `<div class="rank-card"><div class="rank-body">
        <b>Aucun fournisseur de données configuré.</b>
        <p class="muted">Je ne peux pas analyser une action sans fondamentaux réels, et je n'inventerai pas de chiffres. Renseigne une clé gratuite dans <b>Réglages</b>.</p></div></div>`;
      return;
    }
    el.innerHTML = `<div class="empty">Analyse de ${esc(ticker)} — récupération des fondamentaux…</div>`;
    const s = await G.Engine.scoreStock(ticker);
    el.innerHTML = stockCard(s, 0);
  }
  function stockCard(s, i) {
    if (s.noData) {
      return `<div class="rank-card"><div class="rank-head"><div class="rank-no">—</div>
        <div class="rank-title"><strong>${esc(s.name)}</strong><span class="sub">${esc(s.ticker)}</span></div></div>
        <div class="conclusion c-info">${esc(s.conclusion.label)}</div>
        <div class="rank-body"><p>${esc(s.message)}</p></div></div>`;
    }
    const L = { croissance:'Croissance', rentabilite:'Rentabilité', valorisation:'Valorisation', dette:'Dette', qualite:'Qualité', risque:'Risque' };
    const f = s.fundamentals;
    const kv = [];
    const push = (k, v) => { if (v !== null && v !== undefined) kv.push(`<div><span class="k">${k}</span><span class="v">${v}</span></div>`); };
    push('Cours', has(s.price) ? eur2(s.price) : null);
    push('PER', has(f.pe) ? f.pe.toFixed(1) : null);
    push('PEG', has(f.peg) ? f.peg.toFixed(2) + (f._pegDerived ? ' *' : '') : null);
    push('Price/Book', has(f.pb) ? f.pb.toFixed(1) : null);
    push('Marge nette', has(f.netMargin) ? pctA(f.netMargin) : null);
    push('Marge oper.', has(f.operMargin) ? pctA(f.operMargin) : null);
    push('ROE', has(f.roe) ? pctA(f.roe) : null);
    push('Croiss. CA', has(f.revenueGrowth) ? pctS(f.revenueGrowth, 1) : null);
    push('Croiss. BPA', has(f.epsGrowth) ? pctS(f.epsGrowth, 1) : null);
    push('Dette/FP', has(f.debtToEquity) ? f.debtToEquity.toFixed(0) + ' %' : null);
    push('Liquidité gén.', has(f.currentRatio) ? f.currentRatio.toFixed(2) : null);
    push('Rendement', has(f.dividendYield) ? pctA(f.dividendYield) : null);
    push('Bêta', has(f.beta) ? f.beta.toFixed(2) : null);
    if (s.stats) {
      push('Volatilité', pctA(s.stats.vol));
      push('Pire baisse', pctA(s.stats.maxDD));
      push('Perf. 1 an', pctS(s.stats.perf1y, 1));
      push('Perf. 5 ans', pctS(s.stats.perf5y, 1));
    }
    push('Canal 12 m', has(s.pos52) ? s.pos52.toFixed(0) + ' %' : null);
    push('Déjà détenu', s.alreadyPct > 0 ? pctA(s.alreadyPct) : null);

    return `<div class="rank-card ${i < 3 ? 'top' : ''}">
      <div class="rank-head">
        <div class="rank-no">${i + 1}</div>
        <div class="rank-title"><strong>${esc(s.name)}</strong>
          <span class="sub">${esc(s.ticker)}${s.sector ? ' · ' + esc(s.sector) : ''}${s.region ? ' · ' + esc(s.region) : ''}</span></div>
        <div class="score-badge"><div class="v ${scoreCls(s.score)}">${has(s.score) ? s.score : '—'}</div><div class="l">SCORE /100</div></div>
      </div>
      <div class="subscores">${Object.entries(s.subs).filter(([, v]) => has(v)).map(([k, v]) =>
        `<div class="subscore"><span class="k">${L[k]}</span><span class="v ${v >= 7 ? 'score-g' : v >= 5 ? '' : 'score-r'}">${v.toFixed(0)}/10</span></div>`).join('')}</div>
      ${!s.reliable ? `<p class="note">Je n'affiche <b>pas</b> de score global : seules ${s.dimensions} des 6 dimensions ont pu être calculées.
        Un score partiel donnerait une fausse impression de précision. ${has(s.partialScore) ? `<span class="muted">(À titre indicatif, les dimensions disponibles donneraient ${s.partialScore}/100.)</span>` : ''}</p>` : ''}
      <div class="kv">${kv.join('')}</div>
      ${s.fitReasons.length ? `<div class="rank-body"><h5>Adéquation à ton portefeuille</h5>
        <ul>${s.fitReasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      <div class="conclusion ${s.conclusion.cls}">${esc(s.conclusion.label)}</div>
      ${confHTML(s.confidence)}
      <div class="sources">${s.sources.map(x => `<span>· ${esc(x.what)} : <b>${esc(x.src)}</b> — ${esc(x.asOf || '')}</span>`).join('')}
        ${f._pegDerived ? '<span>· * PEG calculé à partir du PER et de la croissance du BPA</span>' : ''}</div>
      <div style="margin-top:10px"><button class="btn sm ghost" data-act="journal-add" data-ticker="${esc(s.ticker)}"
        data-name="${esc(s.name)}" data-price="${s.price || ''}" data-score="${s.score}" data-conf="${s.confidence.score}"
        data-reco="${esc(s.conclusion.label)}">✎ Enregistrer dans le journal</button></div>
    </div>`;
  }

  async function compareWatchlist() {
    const el = $('#stockResults');
    const list = G.Store.state.watchlist.map(w => w.ticker);
    if (!list.length) { toast('Ta watchlist est vide.', 'err'); return; }
    if (!G.Market.hasProvider()) { toast('Aucun fournisseur de données configuré.', 'err'); return; }
    el.innerHTML = `<div class="empty">Analyse de ${list.length} titre(s)…</div>`;
    const snap = G.Store.snapshot(), exp = G.Engine.exposures(snap);
    const res = [];
    for (const t of list) { try { res.push(await G.Engine.scoreStock(t, { snap, exp })); } catch (e) { /* ignoré */ } }
    res.sort((a, b) => (b.score || -1) - (a.score || -1));
    el.innerHTML = res.map((s, i) => stockCard(s, i)).join('');
  }

  function renderWatchlist() {
    const w = G.Store.state.watchlist;
    $('#watchTable').innerHTML = w.length
      ? `<table class="tbl"><thead><tr><th>Ticker</th><th>Nom</th><th></th></tr></thead><tbody>${
        w.map(x => `<tr><td><span class="tick">${esc(x.ticker)}</span></td><td>${esc(x.name || '')}</td>
        <td class="num"><button class="icon-btn" data-act="analyse-w" data-ticker="${esc(x.ticker)}">▶</button>
        <button class="icon-btn" data-act="del-w" data-id="${x.id}">✕</button></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">Watchlist vide. Ajoute les titres que tu veux suivre.</div>`;
  }

  /* ============================================================ IMMOBILIER */
  function renderBricksList() {
    const { ranked } = G.Engine.rankBricks();
    const el = $('#bricksList');
    if (!ranked.length) {
      el.innerHTML = `<div class="empty">Aucun projet enregistré.<br>
        Saisis les projets qui t'intéressent (rendement, durée, garanties, promoteur, LTV) pour que je puisse les classer sur leur rapport rendement/risque.</div>`;
      return;
    }
    el.innerHTML = ranked.map((b, i) => brickCard(b, i)).join('');
  }
  function brickCard(b, i) {
    const p = b.brick;
    const STATUS = { candidat:'Candidat', 'en cours':'En cours', 'en retard':'En retard', 'remboursé':'Remboursé', perdu:'Perte' };
    return `<div class="rank-card ${i < 3 && p.status === 'candidat' ? 'top' : ''}">
      <div class="rank-head">
        <div class="rank-no">${i + 1}</div>
        <div class="rank-title"><strong>${esc(p.name || 'Projet sans nom')}</strong>
          <span class="sub">${esc(p.platform)} · ${esc(STATUS[p.status] || p.status)}${p.location ? ' · ' + esc(p.location) : ''}${p.projectType ? ' · ' + esc(p.projectType) : ''}${p.promoter ? ' · ' + esc(p.promoter) : ''}</span></div>
        <div class="score-badge"><div class="v ${scoreCls(b.score)}">${has(b.score) ? b.score : '—'}</div><div class="l">/100</div></div>
      </div>
      <div class="subscores">${b.components.filter(c => has(c.v)).map(c =>
        `<div class="subscore"><span class="k">${esc(c.k)}</span><span class="v">${c.v.toFixed(0)}/10</span></div>`).join('')}</div>
      <div class="kv">
        <div><span class="k">Rendement annoncé</span><span class="v">${pctA(p.yieldPct)}</span></div>
        <div><span class="k">Durée</span><span class="v">${p.durationMonths || '—'} mois</span></div>
        <div><span class="k">Montant</span><span class="v">${eur(p.amount)}</span></div>
        <div><span class="k">LTV</span><span class="v">${has(p.ltv) ? p.ltv + ' %' : 'non renseigné'}</span></div>
        <div><span class="k">Garanties</span><span class="v">${esc(p.guarantees || 'non renseignées')}</span></div>
      </div>
      ${b.risks.length ? `<div class="rank-body"><h5>Risques identifiés</h5><ul>${b.risks.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
      ${b.notes.length ? `<div class="rank-body"><ul>${b.notes.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
      <div class="conclusion c-watch">Rendement annoncé non garanti · capital pouvant être perdu · placement peu liquide</div>
      ${confHTML(b.confidence)}
      <div style="margin-top:10px"><button class="btn sm ghost" data-act="edit-b" data-id="${p.id}">✎ Modifier</button>
        <button class="btn sm ghost" data-act="del-b" data-id="${p.id}">✕ Supprimer</button></div>
    </div>`;
  }

  /* ============================================================== JOURNAL */
  function renderJournal() {
    const j = G.Store.state.journal;
    const el = $('#journalList');
    if (!j.length) {
      el.innerHTML = `<div class="empty">Aucune décision enregistrée.<br>Après une analyse d'action, clique sur <b>Enregistrer dans le journal</b>.</div>`;
      return;
    }
    el.innerHTML = j.map(e => `<div class="rank-card">
      <div class="rank-head">
        <div class="rank-no">${esc((e.assetType || 'A')[0].toUpperCase())}</div>
        <div class="rank-title"><strong>${esc(e.asset)}</strong>
          <span class="sub">${new Date(e.date).toLocaleString('fr-FR', { dateStyle:'medium' })} · prix analysé ${eur2(e.priceAtAnalysis)}${e._change !== undefined && has(e._change) ? ` · depuis : <b class="${e._change >= 0 ? 'pos' : 'neg'}">${pctS(e._change, 1)}</b>` : ''}</span></div>
        <div class="score-badge"><div class="v ${scoreCls(e.score)}">${has(e.score) ? e.score : '—'}</div><div class="l">/100</div></div>
      </div>
      <div class="kv">
        <div><span class="k">Recommandation</span><span class="v">${esc(e.recommendation || '—')}</span></div>
        <div><span class="k">Confiance</span><span class="v">${has(e.confidence) ? e.confidence + '/100' : '—'}</span></div>
        <div><span class="k">Décision</span><span class="v">${esc(e.decision)}</span></div>
      </div>
      ${e.reason ? `<div class="rank-body"><h5>Raison</h5><p>${esc(e.reason)}</p></div>` : ''}
      ${e.risks ? `<div class="rank-body"><h5>Risques notés</h5><p>${esc(e.risks)}</p></div>` : ''}
      <div style="margin-top:10px" class="row-actions">
        <select class="input sm" data-act="dec" data-id="${e.id}">
          ${['en attente','suivie','ignorée','refusée'].map(d => `<option ${e.decision === d ? 'selected' : ''}>${d}</option>`).join('')}
        </select>
        <button class="btn sm ghost" data-act="del-j" data-id="${e.id}">✕ Supprimer</button>
      </div>
    </div>`).join('');
  }

  async function reviewJournalUI() {
    const el = $('#journalReview');
    el.innerHTML = `<div class="empty">Relecture en cours — récupération des cours actuels…</div>`;
    const r = await G.Engine.reviewJournal();
    el.innerHTML = `<div class="plan-block"><h4>Relecture</h4><p>${esc(r.summary)}</p>
      ${r.stats ? `<div class="kv">
        <div><span class="k">Analyses matures</span><span class="v">${r.stats.total}</span></div>
        <div><span class="k">Avis favorables</span><span class="v">${r.stats.positive}${has(r.stats.avgPos) ? ' · ' + pctS(r.stats.avgPos, 1) : ''}</span></div>
        <div><span class="k">Avis réservés</span><span class="v">${r.stats.negative}${has(r.stats.avgNeg) ? ' · ' + pctS(r.stats.avgNeg, 1) : ''}</span></div>
        ${has(r.stats.discrimination) ? `<div><span class="k">Pouvoir discriminant</span><span class="v">${pctS(r.stats.discrimination, 1)} pts</span></div>` : ''}
      </div>` : ''}
      <p class="muted sm">Une bonne analyse peut donner un mauvais résultat, et l'inverse. Ce qui est mesuré ici, c'est l'écart entre les avis favorables et réservés — pas la chance.</p></div>`;
    // enrichit la liste avec l'évolution
    const map = {}; r.entries.forEach(e => map[e.id] = e);
    G.Store.state.journal.forEach(e => { if (map[e.id]) e._change = map[e.id]._change; });
    renderJournal();
  }

  /* ================================================================ RÉGLAGES */
  function renderSettings() {
    const st = G.Store.state;
    $('#setProfile').value = st.profile.riskProfile;
    $('#setHorizon').value = st.profile.horizonYears;
    $('#setMonthly').value = st.profile.monthlyBudget;
    $('#setCapital').value = st.profile.availableCash;
    $('#tgtEtf').value = st.profile.target.etf;
    $('#tgtActions').value = st.profile.target.actions;
    $('#tgtCrypto').value = st.profile.target.crypto;
    $('#tgtImmo').value = st.profile.target.immobilier;
    updateTargetSum();
    $('#keyTwelve').value = st.settings.keys.twelvedata || '';
    $('#keyFinnhub').value = st.settings.keys.finnhub || '';
    $('#keyAlpha').value = st.settings.keys.alphavantage || '';
    $('#keyAnthropic').value = st.settings.keys.anthropic || '';
    $('#planCapital').value = st.profile.availableCash;
    $('#planMonthly').value = st.profile.monthlyBudget;
    $('#planHorizon').value = st.profile.horizonYears;
    $('#planProfile').value = st.profile.riskProfile;
    const prof = G.DATA.PROFILES[st.profile.riskProfile];
    const snap = G.Store.snapshot();
    if (!$('#simInit').value) $('#simInit').value = Math.round(snap.total) || 1000;
    if (!$('#simMonthly').value) $('#simMonthly').value = st.profile.monthlyBudget;
    if (!$('#simYears').value) $('#simYears').value = st.profile.horizonYears;
    if (!$('#simRate').value) $('#simRate').value = prof.hypotheses.central;
    if (!$('#simVol').value) $('#simVol').value = prof.hypotheses.vol;
  }
  function updateTargetSum() {
    const sum = ['#tgtEtf', '#tgtActions', '#tgtCrypto', '#tgtImmo'].reduce((s, id) => s + (Number($(id).value) || 0), 0);
    const el = $('#targetSum');
    el.textContent = `total ${sum} %`;
    el.style.color = sum === 100 ? 'var(--pos)' : 'var(--warn)';
  }

  /* =================================================================== CHAT */
  function addMsg(role, html, id) {
    const log = $('#chatLog');
    const d = document.createElement('div');
    d.className = 'msg ' + (role === 'user' ? 'me' : 'ai');
    if (id) d.id = id;
    d.innerHTML = `<div class="av">${role === 'user' ? '·' : 'IA'}</div><div class="bubble">${html}</div>`;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }
  function addTyping(text) {
    const d = addMsg('ai', `<div class="typing"><i></i><i></i><i></i></div>${text ? `<div class="muted sm" style="margin-top:6px">${esc(text)}</div>` : ''}`, 'typingMsg');
    return d;
  }
  function setTypingNote(text) {
    const t = $('#typingMsg');
    if (t) t.querySelector('.bubble').innerHTML = `<div class="typing"><i></i><i></i><i></i></div><div class="muted sm" style="margin-top:6px">${esc(text)}</div>`;
    $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
  }
  function removeTyping() { const t = $('#typingMsg'); if (t) t.remove(); }

  function renderChatHistory() {
    const log = $('#chatLog');
    log.innerHTML = '';
    const h = G.Store.state.chat;
    if (!h.length) {
      G.Agent.ask('bonjour').then(r => {
        addMsg('ai', md(r.text));
        G.Store.state.chat.push({ role: 'assistant', text: r.text }); G.Store.save();
      });
    } else {
      h.forEach(m => addMsg(m.role === 'user' ? 'user' : 'ai', m.role === 'user' ? esc(m.text) : md(m.text)));
    }
    $('#chatSuggest').innerHTML = [
      'Analyse mon portefeuille', "J'ai 300 € à investir ce mois-ci", 'Trouve-moi un ETF Monde intéressant',
      'Est-ce que je suis suffisamment diversifié ?', 'Compare Apple, Microsoft et Nvidia',
      'Dois-je rééquilibrer mon portefeuille ?'
    ].map(q => `<button data-q="${esc(q)}">${esc(q)}</button>`).join('');
    const mode = G.Store.state.settings.keys.anthropic ? 'Langage naturel étendu actif.' : 'Mode local gratuit (analyse par mots-clés).';
    $('#chatMode').textContent = mode;
  }

  G.UI = {
    $, $$, esc, eur, eur2, pctS, pctA, md, toast, openModal, setModalBody, closeModal, modalValues, field,
    go, renderDashboard, renderPortfolio, renderEtfRanking, renderBricksList, renderJournal,
    renderWatchlist, renderSettings, updateTargetSum, renderChatHistory, addMsg, addTyping,
    setTypingNote, removeTyping, holdingModal, txModal, brickModal, etfModal,
    analyseStock, compareWatchlist, reviewJournalUI, stockCard, confHTML, scoreCls,
    get modalOnSave() { return modalOnSave; }
  };
})(window);
