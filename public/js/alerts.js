/* ============================================================================
   alerts.js — Alertes de prix : interface, notifications, évaluation locale.

   La RÈGLE de déclenchement vit dans alerts-rules.js, partagée avec le serveur.
   Ce fichier ne fait que l'appliquer et la donner à voir.

   Ce que l'application sait faire, et ce qu'elle ne sait pas :
   · en mode serveur, les alertes sont évaluées à chaque rafraîchissement
     automatique — donc même si aucun navigateur n'est ouvert ;
   · une notification système n'apparaît que si cet onglet est ouvert et que
     tu as accordé la permission. Il n'y a PAS de notification push sur
     téléphone quand l'application est fermée : cela demanderait un service de
     push, que ce projet auto-hébergé n'a pas.
   ========================================================================== */
(function (G) {
  'use strict';
  const R = G.AlertRules;
  const $ = s => document.querySelector(s);
  const esc = s => G.UI.esc(s);

  /* ------------------------------------------------------ notifications */
  function canNotify() { return 'Notification' in window; }
  function notifyState() { return canNotify() ? Notification.permission : 'indisponible'; }

  async function askPermission() {
    if (!canNotify()) { G.UI.toast("Ce navigateur ne gère pas les notifications.", 'err'); return false; }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') {
      G.UI.toast("Les notifications sont bloquées pour ce site. Réactive-les dans les réglages du navigateur.", 'err');
      return false;
    }
    const p = await Notification.requestPermission();
    return p === 'granted';
  }

  function notify(alert) {
    if (!canNotify() || Notification.permission !== 'granted') return;
    try {
      new Notification('InvestAI — alerte de prix', {
        body: R.describe(alert) + (alert.note ? '\n' + alert.note : ''),
        tag: 'mia-alert-' + alert.id            // pas de doublon pour la même alerte
      });
    } catch (e) { /* certains navigateurs refusent hors service worker */ }
  }

  /* -------------------------------------------------------- évaluation */
  /** Évalue les alertes contre les cours connus des positions et de la
   *  watchlist. Appelée après chaque rafraîchissement. */
  function check(silencieux) {
    const st = G.Store.state;
    const prices = {};
    G.Store.snapshot().holdings.forEach(h => {
      if (h.ticker && h._live) prices[String(h.ticker).toUpperCase()] = h._price;
    });
    // les alertes peuvent porter sur un ticker non détenu : on regarde le cache
    (st.alerts || []).forEach(a => {
      const k = String(a.ticker || '').toUpperCase();
      if (prices[k] !== undefined) return;
      const c = st.cache && st.cache.quotes && st.cache.quotes[k];
      if (c && c.v && c.v.price) prices[k] = c.v.price;
    });

    const fired = R.evaluate(st.alerts, prices, new Date().toISOString());
    if (fired.length) {
      G.Store.save(true);
      if (!silencieux) {
        fired.forEach(notify);
        G.UI.toast(fired.length === 1 ? R.describe(fired[0])
                                      : `${fired.length} alertes de prix déclenchées.`, 'ok');
      }
    }
    render();
    return fired;
  }

  /* ------------------------------------------------------------- rendu */
  /** Pastille du bandeau : nombre d'alertes déclenchées non lues. */
  function renderBadge() {
    const n = G.Store.pendingAlerts().length;
    const b = $('#btnAlerts'); if (!b) return;
    b.classList.toggle('has-alerts', n > 0);
    b.innerHTML = '⏰ Alertes' + (n ? ` <span class="badge">${n}</span>` : '');
  }

  function render() {
    renderBadge();
    const box = $('#alertsList'); if (!box) return;
    const st = G.Store.state;
    const list = (st.alerts || []).slice().sort((a, b) => {
      if (!!b.triggeredAt - !!a.triggeredAt) return !!b.triggeredAt - !!a.triggeredAt;
      return String(a.ticker).localeCompare(String(b.ticker));
    });
    if (!list.length) {
      box.innerHTML = `<div class="empty">Aucune alerte.<br>
        Clique sur <b>+ Alerte</b> pour être prévenu quand un cours atteint ton seuil.</div>`;
      return;
    }
    const cours = {};
    G.Store.snapshot().holdings.forEach(h => { if (h._live) cours[h.ticker] = h._price; });

    box.innerHTML = `<table class="tbl"><thead><tr>
        <th>État</th><th>Actif</th><th>Condition</th><th class="num">Cours actuel</th>
        <th class="num">Écart</th><th>Note</th><th></th>
      </tr></thead><tbody>${list.map(a => {
        const p = cours[a.ticker];
        const ecart = (p && a.price) ? (p / a.price - 1) * 100 : null;
        const etat = a.triggeredAt
          ? `<span class="tag fired">✔ déclenchée</span>`
          : a.active ? `<span class="tag watch">en veille</span>`
                     : `<span class="tag">en pause</span>`;
        return `<tr data-aid="${a.id}">
          <td>${etat}${a.triggeredAt ? `<span class="sub">${esc(a.triggeredAt.slice(0, 10))} · ${R.fmt(a.triggeredPrice)} €</span>` : ''}</td>
          <td><span class="tick">${esc(a.ticker)}</span></td>
          <td>${a.kind === 'below' ? 'descend sous' : 'atteint'} <b>${R.fmt(a.price)} €</b></td>
          <td class="num">${p ? R.fmt(p) + ' €' : '<span class="muted">—</span>'}</td>
          <td class="num ${ecart === null ? 'muted' : ecart >= 0 ? 'pos' : 'neg'}">${
            ecart === null ? '—' : (ecart >= 0 ? '+' : '') + ecart.toFixed(1) + ' %'}</td>
          <td><span class="sub">${esc(a.note || '')}</span></td>
          <td class="num">
            ${a.triggeredAt ? `<button class="icon-btn" data-act="rearm-a" data-id="${a.id}" title="Réarmer">↻</button>` : ''}
            <button class="icon-btn" data-act="edit-a" data-id="${a.id}">✎</button>
            <button class="icon-btn" data-act="del-a" data-id="${a.id}">✕</button>
          </td></tr>`;
      }).join('')}</tbody></table>`;
  }

  /* ---------------------------------------------------------- formulaire */
  function modal(id, prefill) {
    const a = id ? G.Store.state.alerts.find(x => x.id === id) : null;
    const F = G.UI.field;
    const tickers = [...new Set(G.Store.state.holdings.map(h => h.ticker).filter(Boolean))];
    const t = a ? a.ticker : (prefill && prefill.ticker) || tickers[0] || '';
    const cours = (G.Store.snapshot().holdings.find(h => h.ticker === t) || {})._price;

    const body = `<div class="field-grid">
      ${F('ticker', 'Actif', { type: 'select', value: t,
        options: tickers.length ? tickers.map(x => ({ v: x, l: x })) : [{ v: '', l: '— aucune position —' }] })}
      ${F('kind', 'Condition', { type: 'select', value: a ? a.kind : 'above',
        options: [{ v: 'above', l: 'Le cours atteint ou dépasse' }, { v: 'below', l: 'Le cours descend sous' }] })}
      ${F('price', 'Seuil (€)', { type: 'number', value: a ? a.price : '', ph: cours ? R.fmt(cours) : '2.50' })}
      ${F('note', 'Note (facultatif)', { full: true, value: a ? a.note : '',
        ph: 'ce que je compte faire à ce niveau' })}
    </div>
    ${cours ? `<p class="note" style="margin-top:12px">Cours actuel de ${esc(t)} : <b>${R.fmt(cours)} €</b>.</p>` : ''}
    <p class="note">Une alerte prévient, elle ne décide pas et ne passe aucun ordre.
    Elle se déclenche une seule fois, puis reste à réarmer.</p>`;

    G.UI.openModal(id ? "Modifier l'alerte" : 'Nouvelle alerte de prix', body, null, () => {
      const v = G.UI.modalValues();
      v.price = Number(String(v.price).replace(',', '.'));
      if (!v.ticker) { G.UI.toast('Choisis un actif.', 'err'); return false; }
      if (!(v.price > 0)) { G.UI.toast('Saisis un seuil supérieur à zéro.', 'err'); return false; }
      if (id) G.Store.rearmAlert(id) && G.Store.updateAlert(id, v);
      else G.Store.addAlert(v);
      G.UI.toast('Alerte enregistrée.', 'ok');
      render();
      askPermission();          // proposée au moment où elle devient utile
    });
  }

  /* ------------------------------------------------------------ câblage */
  function wire() {
    const add = $('#btnAddAlert'); if (add) add.addEventListener('click', () => modal());
    const bell = $('#btnAlerts');
    if (bell) bell.addEventListener('click', () => {
      G.UI.go('portfolio');
      G.Store.markAlertsSeen();
      renderBadge();
      const el = $('#alertsCard'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = b.dataset.id;
      if (b.dataset.act === 'edit-a') modal(id);
      else if (b.dataset.act === 'del-a') { if (confirm('Supprimer cette alerte ?')) { G.Store.removeAlert(id); render(); } }
      else if (b.dataset.act === 'rearm-a') { G.Store.rearmAlert(id); render(); G.UI.toast('Alerte réarmée.', 'ok'); }
    });
    // au démarrage : ce que le serveur a déclenché pendant notre absence
    const enAttente = G.Store.pendingAlerts();
    if (enAttente.length) {
      G.UI.toast(enAttente.length === 1
        ? R.describe(enAttente[0])
        : `${enAttente.length} alertes se sont déclenchées depuis ta dernière visite.`, 'ok');
    }
    render();
  }

  G.Alerts = { wire, check, render, renderBadge, modal, askPermission, notifyState };
})(window);
