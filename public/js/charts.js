/* ============================================================================
   charts.js — Graphiques SVG sans dépendance externe
   ========================================================================== */
(function (G) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

  /* --------------------------------------------------------------- Donut */
  function donut(el, data, opts) {
    opts = opts || {};
    const size = opts.size || 168, r = size / 2, thick = opts.thick || 26;
    const total = data.reduce((s, d) => s + d.value, 0);
    if (!total) { el.innerHTML = `<div class="empty">Aucune donnée</div>`; return; }
    const rad = r - thick / 2;
    let a0 = -Math.PI / 2;
    const arcs = data.filter(d => d.value > 0).map(d => {
      const frac = d.value / total;
      const a1 = a0 + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const x0 = r + rad * Math.cos(a0), y0 = r + rad * Math.sin(a0);
      const x1 = r + rad * Math.cos(a1), y1 = r + rad * Math.sin(a1);
      const path = frac > 0.999
        ? `M ${r} ${r - rad} A ${rad} ${rad} 0 1 1 ${r - 0.01} ${r - rad}`
        : `M ${x0} ${y0} A ${rad} ${rad} 0 ${large} 1 ${x1} ${y1}`;
      a0 = a1;
      return `<path d="${path}" fill="none" stroke="${d.color}" stroke-width="${thick}" stroke-linecap="butt"><title>${esc(d.label)} : ${(frac*100).toFixed(1)} %</title></path>`;
    }).join('');
    const center = opts.center || '';
    el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${r}" cy="${r}" r="${rad}" fill="none" stroke="var(--surface-3)" stroke-width="${thick}"/>
      ${arcs}
      ${center ? `<text x="${r}" y="${r - 4}" text-anchor="middle" fill="var(--ink)" font-size="15" font-weight="700">${esc(center.top || '')}</text>
        <text x="${r}" y="${r + 13}" text-anchor="middle" fill="var(--ink-4)" font-size="10.5">${esc(center.bottom || '')}</text>` : ''}
    </svg>`;
  }

  /* ------------------------------------------------------- Barres cible/réel */
  function targetBars(el, rows) {
    if (!rows.length) { el.innerHTML = `<div class="empty">Aucune donnée</div>`; return; }
    const max = Math.max(100, ...rows.map(r => Math.max(r.actual, r.target)));
    el.innerHTML = rows.map(r => {
      const gap = r.actual - r.target;
      const cls = Math.abs(gap) < 5 ? 'drift-ok' : Math.abs(gap) < 12 ? 'drift-warn' : 'drift-bad';
      return `<div class="bar-row">
        <div class="bar-top">
          <span class="nm">${esc(r.label)}<span class="drift-tag ${cls}">${gap >= 0 ? '+' : ''}${gap.toFixed(1)} pts</span></span>
          <span class="vl">${r.actual.toFixed(1)} % <span class="muted">/ ${r.target} %</span></span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${Math.min(100, r.actual / max * 100)}%;background:${r.color || 'var(--navy)'}"></div>
          <div class="bar-target" style="left:${Math.min(100, r.target / max * 100)}%"></div>
        </div>
      </div>`;
    }).join('');
  }

  /* ------------------------------------------------------ Barres d'exposition */
  function expoBars(el, rows, opts) {
    opts = opts || {};
    const list = rows.filter(r => r.pct > 0.3).slice(0, opts.limit || 9);
    if (!list.length) { el.innerHTML = `<div class="empty">Aucune donnée de composition. Rattache tes ETF au catalogue et renseigne le secteur de tes actions.</div>`; return; }
    const max = Math.max(...list.map(r => r.pct));
    const P = G.DATA.PALETTE;
    el.innerHTML = list.map((r, i) => `<div class="bar-row">
      <div class="bar-top"><span class="nm">${esc(r.key)}</span><span class="vl">${r.pct.toFixed(1)} %</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${r.pct / max * 100}%;background:${P[i % P.length]}"></div></div>
    </div>`).join('');
  }

  /* ------------------------------------------------- Histogramme mensuel */
  function monthlyBars(el, series) {
    const W = 100, H = 130, pad = 18;
    const max = Math.max(1, ...series.map(s => s.amount));
    const n = series.length, bw = (W - 4) / n;
    const bars = series.map((s, i) => {
      const h = (s.amount / max) * (H - pad - 14);
      const x = 2 + i * bw, y = H - pad - h;
      const label = s.month.slice(5) + '/' + s.month.slice(2, 4);
      return `<g><rect x="${x + bw * .16}" y="${y}" width="${bw * .68}" height="${Math.max(h, s.amount > 0 ? 1.5 : 0)}"
        rx="1" fill="${s.amount > 0 ? 'var(--navy)' : 'var(--rule)'}" opacity="${s.amount > 0 ? 1 : .5}">
        <title>${label} : ${new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(s.amount)}</title></rect>
        <text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" class="chart-tip" font-size="4.2">${s.month.slice(5)}</text></g>`;
    }).join('');
    const total = series.reduce((s, x) => s + x.amount, 0);
    const avg = total / (n || 1);
    const ay = H - pad - (avg / max) * (H - pad - 14);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:150px">
      ${bars}
      ${avg > 0 ? `<line x1="2" x2="${W - 2}" y1="${ay}" y2="${ay}" stroke="var(--ink-4)" stroke-width=".4" stroke-dasharray="1.5 1.5"/>` : ''}
      <line x1="2" x2="${W - 2}" y1="${H - pad}" y2="${H - pad}" stroke="var(--rule)" stroke-width=".4"/>
    </svg>
    <div class="muted sm" style="margin-top:6px">Moyenne : <b>${new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(avg)}</b>/mois · Total 12 mois : <b>${new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(total)}</b></div>`;
  }

  /* ------------------------------------------- Courbes de projection (simulateur) */
  function projection(el, sim) {
    const W = 640, H = 260, L = 56, R = 12, T = 14, B = 30;
    const pts = sim.scenarios.central.points;
    const maxV = Math.max(sim.scenarios.opti.final, sim.mc.p90, sim.paid, 1);
    const months = sim.months;
    const x = m => L + (m / months) * (W - L - R);
    const y = v => T + (1 - v / maxV) * (H - T - B);

    const line = (points, color, width, dash) =>
      `<path d="${points.map((p, i) => (i ? 'L' : 'M') + x(p.m).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ')}"
        fill="none" stroke="${color}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linejoin="round"/>`;

    // bande pessimiste→optimiste
    const up = sim.scenarios.opti.points, dn = sim.scenarios.pess.points;
    const band = `<path d="${up.map((p, i) => (i ? 'L' : 'M') + x(p.m).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ')}
      ${dn.slice().reverse().map(p => 'L' + x(p.m).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ')} Z"
      fill="url(#bandg)" opacity=".28"/>`;

    // versements cumulés
    const paid = pts.map(p => ({ m: p.m, v: p.paid }));

    const yTicks = 5, ticks = [];
    for (let i = 0; i <= yTicks; i++) {
      const v = maxV * i / yTicks;
      ticks.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--rule)" stroke-width=".7"/>
        <text x="${L - 7}" y="${y(v) + 3.5}" text-anchor="end" class="chart-tip">${fmtShort(v)}</text>`);
    }
    const xTicks = [];
    const step = sim.years <= 12 ? 12 : 24;
    for (let m = 0; m <= months; m += step) {
      xTicks.push(`<text x="${x(m)}" y="${H - B + 17}" text-anchor="middle" class="chart-tip">${Math.round(m / 12)} an${m / 12 > 1 ? 's' : ''}</text>`);
    }

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
      <defs><linearGradient id="bandg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3ecf8e"/><stop offset="100%" stop-color="#ff6b6b"/></linearGradient></defs>
      ${ticks.join('')}
      ${band}
      ${line(paid, 'var(--ink-4)', 1.4, '4 3')}
      ${line(dn, 'var(--neg)', 1.4)}
      ${line(up, 'var(--pos)', 1.4)}
      ${line(pts, 'var(--navy)', 2.6)}
      ${xTicks.join('')}
    </svg>
    <div class="muted sm" style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px">
      <span style="color:var(--navy)">━ scénario central</span>
      <span style="color:var(--pos)">━ optimiste</span>
      <span style="color:var(--neg)">━ pessimiste</span>
      <span style="color:var(--ink-4)">╌ total versé</span>
    </div>`;
  }

  function fmtShort(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace('.', ',') + ' M€';
    if (v >= 1e3) return Math.round(v / 1e3) + ' k€';
    return Math.round(v) + ' €';
  }

  G.Charts = { donut, targetBars, expoBars, monthlyBars, projection, fmtShort };
})(window);
