/* ============================================================================
   vision.js — Import de positions depuis des captures d'écran.

   Tu envoies une ou plusieurs photos (Binance, Bitstack, Crypto.com, ton
   courtier…), Claude en extrait des positions structurées, et l'application
   te les présente dans un tableau **que tu valides ligne par ligne** avant que
   quoi que ce soit ne soit créé.

   RÈGLE 1 — jamais de donnée inventée : rien n'est enregistré automatiquement.
   Une lecture reste une lecture, pas une source de vérité. Chaque ligne porte
   le niveau de confiance de l'extraction et ce qui a été lu littéralement.
   ========================================================================== */
(function (G) {
  'use strict';

  const MAX_IMAGES = 8;
  const MAX_SIDE = 1600;          // redimensionnement avant envoi
  const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

  let pending = [];               // positions extraites, en attente de validation
  let files = [];                 // images choisies

  /* ------------------------------------------------------------ disponible ? */
  function enabled() {
    if (G.Api && G.Api.isServer) return !!(G.Api.config && G.Api.config.visionEnabled);
    return !!(G.Store.state.settings.keys.anthropic || '').trim();
  }

  /* ------------------------------------------------- préparation des images
     Les captures de téléphone font souvent 3–4 Mo : on les réduit côté
     navigateur pour rester rapide et sous les limites de l'API.            */
  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        // JPEG : une capture d'écran compresse bien et le texte reste lisible
        const dataUrl = cv.toDataURL('image/jpeg', 0.85);
        resolve({ mediaType: 'image/jpeg', data: dataUrl.split(',')[1], w, h });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image illisible : ' + file.name)); };
      img.src = url;
    });
  }

  /* ------------------------------------------------------------- extraction */
  async function extract(images) {
    const raw = (G.Api && G.Api.isServer)
      ? await viaServer(images)
      : await viaBrowser(images);
    return parse(raw);
  }

  async function viaServer(images) {
    const r = await fetch('/api/vision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ images })
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
    return j.text;
  }

  /** Mode hors ligne : la clé est celle saisie dans Réglages, elle ne quitte
   *  ce navigateur que pour appeler Anthropic. */
  async function viaBrowser(images) {
    const key = (G.Store.state.settings.keys.anthropic || '').trim();
    if (!key) throw new Error('Ajoute ta clé Anthropic dans Réglages pour lire des photos.');
    const content = images.map(im => ({
      type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data }
    }));
    content.push({ type: 'text', text: PROMPT });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5', max_tokens: 4000,
        system: SYSTEM, messages: [{ role: 'user', content }]
      })
    });
    if (!r.ok) throw new Error('API Anthropic ' + r.status);
    const j = await r.json();
    return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  }

  /** Le modèle peut encadrer sa réponse d'un bloc de code : on récupère
   *  l'objet JSON quoi qu'il arrive, sans jamais faire confiance au format. */
  function parse(text) {
    if (!text) throw new Error('réponse vide');
    let s = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('réponse illisible');
    const o = JSON.parse(s.slice(a, b + 1));
    return {
      positions: Array.isArray(o.positions) ? o.positions.map(clean).filter(Boolean) : [],
      warnings: Array.isArray(o.warnings) ? o.warnings.map(String) : [],
      detected: o.detected || null
    };
  }

  const numOrNull = v => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : null;
  };

  /** Normalise une ligne extraite. Ce qui est douteux reste nul — l'écran de
   *  validation le montre en rouge plutôt que de le combler. */
  function clean(p) {
    if (!p || typeof p !== 'object') return null;
    const ticker = String(p.ticker || '').trim().toUpperCase().slice(0, 20);
    const name = String(p.name || '').trim().slice(0, 80);
    if (!ticker && !name) return null;
    let type = String(p.type || '').toLowerCase();
    if (!['crypto', 'etf', 'action'].includes(type)) {
      type = G.Store.cryptoMeta(ticker) ? 'crypto' : 'etf';
    }
    // un ticker connu du catalogue crypto tranche le doute
    if (type !== 'crypto' && G.Store.cryptoMeta(ticker)) type = 'crypto';
    return {
      _id: Math.random().toString(36).slice(2, 9),
      _keep: true,
      type, ticker, name: name || (G.Store.cryptoMeta(ticker) || {}).n || '',
      quantity: numOrNull(p.quantity),
      avgPrice: numOrNull(p.avgPrice),
      currency: /^[A-Z]{3}$/.test(String(p.currency || '').toUpperCase())
        ? String(p.currency).toUpperCase() : 'EUR',
      account: String(p.account || '').trim().slice(0, 30) || 'Autre',
      confidence: ['haute', 'moyenne', 'basse'].includes(p.confidence) ? p.confidence : 'moyenne',
      source: String(p.source || '').slice(0, 120)
    };
  }

  const SYSTEM = [
    "Tu extrais des positions financières depuis des captures d'écran de portefeuilles.",
    'Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte autour.',
    'Schéma : {"positions":[{"type":"crypto|etf|action","ticker":"BTC","name":"Bitcoin","quantity":0.0345,"avgPrice":41200.5,"currency":"EUR","account":"Binance","confidence":"haute|moyenne|basse","source":"ce que tu as lu"}],"warnings":["…"],"detected":"plateforme ou null"}',
    "N'invente JAMAIS une valeur : un champ illisible vaut null.",
    'Ne convertis rien. `quantity` est la quantité détenue, pas une valeur en euros.',
    "`avgPrice` est le prix de revient unitaire ; si l'écran ne montre que le cours actuel, laisse null et signale-le.",
    'Format français : « 1 234,56 » vaut 1234.56. Ignore les totaux et les lignes de gains/pertes.'
  ].join('\n');
  const PROMPT = 'Extrais toutes les positions visibles sur ces captures. Réponds uniquement avec le JSON du schéma.';

  /* ================================================================= ÉCRAN */
  const esc = s => G.UI.esc(s);

  function openImport() {
    if (!enabled()) {
      G.UI.toast("La lecture de photo demande une clé Anthropic. Ajoute-la dans Réglages.", 'err');
      G.UI.go('settings');
      return;
    }
    files = []; pending = [];
    G.UI.openModal('Importer depuis une photo', pickerHTML(), null, null, { wide: true, noSave: true });
    wirePicker();
  }

  function pickerHTML() {
    return `
      <p class="note">Envoie des captures d'écran de tes comptes — Binance, Bitstack,
      Crypto.com, ton courtier… Jusqu'à ${MAX_IMAGES} images à la fois.
      <b>Rien ne sera créé sans ta validation</b> : tu verras d'abord ce qui a été lu.</p>
      <div id="vDrop" class="v-drop">
        <input type="file" id="vFiles" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
        <div class="v-drop-in">
          <div class="v-drop-icon">⤢</div>
          <div>Dépose tes images ici, ou <button class="btn sm" id="vPick" type="button">choisis des fichiers</button></div>
          <div class="muted sm">PNG, JPEG, WebP · les images sont réduites avant envoi</div>
        </div>
      </div>
      <div id="vThumbs" class="v-thumbs"></div>
      <div id="vStatus" class="v-status"></div>
      <div class="row-actions" style="margin-top:14px;justify-content:flex-end">
        <button class="btn primary" id="vGo" type="button" disabled>Lire les images</button>
      </div>`;
  }

  function wirePicker() {
    const drop = document.querySelector('#vDrop');
    const input = document.querySelector('#vFiles');
    document.querySelector('#vPick').addEventListener('click', () => input.click());
    input.addEventListener('change', () => addFiles(input.files));
    ['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => {
      ev.preventDefault(); drop.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => {
      ev.preventDefault(); drop.classList.remove('over');
    }));
    drop.addEventListener('drop', ev => addFiles(ev.dataTransfer.files));
    document.querySelector('#vGo').addEventListener('click', run);
  }

  function addFiles(list) {
    for (const f of Array.from(list || [])) {
      if (!ALLOWED.includes(f.type)) continue;
      if (files.length >= MAX_IMAGES) break;
      files.push(f);
    }
    renderThumbs();
  }

  function renderThumbs() {
    const box = document.querySelector('#vThumbs');
    if (!box) return;
    box.innerHTML = files.map((f, i) =>
      `<div class="v-thumb"><img src="${URL.createObjectURL(f)}" alt="">
        <button class="v-thumb-x" data-i="${i}" type="button" title="Retirer">✕</button>
        <span>${esc(f.name.slice(0, 22))}</span></div>`).join('');
    box.querySelectorAll('.v-thumb-x').forEach(b => b.addEventListener('click', () => {
      files.splice(Number(b.dataset.i), 1); renderThumbs();
    }));
    const go = document.querySelector('#vGo');
    if (go) go.disabled = files.length === 0;
  }

  async function run() {
    const status = document.querySelector('#vStatus');
    const go = document.querySelector('#vGo');
    go.disabled = true;
    try {
      status.innerHTML = `<span class="muted">Préparation des images…</span>`;
      const images = [];
      for (const f of files) images.push(await toBase64(f));
      status.innerHTML = `<span class="muted">Lecture par InvestAI — ${images.length} image(s)…</span>`;
      const res = await extract(images);
      pending = res.positions;
      if (!pending.length) {
        status.innerHTML = `<div class="v-err">Aucune position lisible sur ces images.
          ${res.warnings.map(w => `<div>${esc(w)}</div>`).join('')}</div>`;
        go.disabled = false;
        return;
      }
      showReview(res);
    } catch (e) {
      status.innerHTML = `<div class="v-err">${esc(e.message)}</div>`;
      go.disabled = false;
    }
  }

  /* ------------------------------------------------------------ validation */
  function showReview(res) {
    const body = `
      <p class="note">${res.detected ? `Plateforme reconnue : <b>${esc(res.detected)}</b>. ` : ''}
      <b>${pending.length}</b> position(s) lue(s). Vérifie chaque ligne : une lecture d'image
      n'est pas une source de vérité. Décoche ce que tu ne veux pas, corrige ce qui est faux.</p>
      ${res.warnings.length ? `<div class="v-warn">${res.warnings.map(w => `<div>⚠ ${esc(w)}</div>`).join('')}</div>` : ''}
      <div class="table-wrap"><table class="tbl v-review"><thead><tr>
        <th></th><th>Type</th><th>Ticker</th><th>Nom</th>
        <th class="num">Quantité</th><th class="num">PRU</th><th>Devise</th><th>Compte</th><th>Lecture</th>
      </tr></thead><tbody>${pending.map(rowHTML).join('')}</tbody></table></div>
      <p class="note" style="margin-top:12px">Les cases vides n'ont pas pu être lues — remplis-les
      toi-même plutôt que de laisser l'application deviner. Sans prix de revient, la position sera
      créée mais sa plus-value restera à zéro tant que tu ne l'auras pas saisi.</p>
      <div class="row-actions" style="margin-top:14px;justify-content:flex-end">
        <button class="btn" id="vBack" type="button">← Autres images</button>
        <button class="btn primary" id="vConfirm" type="button">Créer les positions cochées</button>
      </div>`;
    G.UI.setModalBody('Vérifie avant de créer', body);
    wireReview();
  }

  function rowHTML(p) {
    const miss = v => v === null ? ' class="v-miss"' : '';
    const cf = { haute: 'ok', moyenne: 'mid', basse: 'low' }[p.confidence];
    return `<tr data-id="${p._id}">
      <td><input type="checkbox" class="v-keep" ${p._keep ? 'checked' : ''}></td>
      <td><select class="input sm v-f" data-f="type">
        ${[['crypto', 'Crypto'], ['etf', 'ETF'], ['action', 'Action']].map(([v, l]) =>
          `<option value="${v}"${p.type === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select></td>
      <td><input class="input sm v-f" data-f="ticker" value="${esc(p.ticker)}"></td>
      <td><input class="input sm v-f" data-f="name" value="${esc(p.name)}"></td>
      <td${miss(p.quantity)}><input class="input sm v-f num" data-f="quantity" type="number" step="any" value="${p.quantity ?? ''}"></td>
      <td${miss(p.avgPrice)}><input class="input sm v-f num" data-f="avgPrice" type="number" step="any" value="${p.avgPrice ?? ''}"></td>
      <td><input class="input sm v-f" data-f="currency" value="${esc(p.currency)}" size="4"></td>
      <td><input class="input sm v-f" data-f="account" value="${esc(p.account)}"></td>
      <td><span class="v-cf v-cf-${cf}" title="${esc(p.source)}">${p.confidence}</span></td>
    </tr>`;
  }

  function wireReview() {
    document.querySelector('#vBack').addEventListener('click', () => {
      G.UI.setModalBody('Importer depuis une photo', pickerHTML());
      wirePicker(); renderThumbs();
    });
    document.querySelectorAll('.v-review tr[data-id]').forEach(tr => {
      const p = pending.find(x => x._id === tr.dataset.id);
      tr.querySelector('.v-keep').addEventListener('change', e => p._keep = e.target.checked);
      tr.querySelectorAll('.v-f').forEach(inp => inp.addEventListener('input', e => {
        const f = e.target.dataset.f;
        p[f] = (f === 'quantity' || f === 'avgPrice')
          ? (e.target.value === '' ? null : Number(e.target.value))
          : e.target.value;
      }));
    });
    document.querySelector('#vConfirm').addEventListener('click', confirmImport);
  }

  function confirmImport() {
    const keep = pending.filter(p => p._keep && (p.ticker || p.name));
    if (!keep.length) { G.UI.toast('Aucune ligne cochée.', 'err'); return; }
    const sansQte = keep.filter(p => !p.quantity).length;
    if (sansQte && !confirm(
      `${sansQte} position(s) n'ont pas de quantité : elles seront créées à 0 et ne compteront pas ` +
      `dans ton patrimoine tant que tu ne l'auras pas saisie.\n\nContinuer ?`)) return;

    let n = 0;
    keep.forEach(p => {
      G.Store.addHolding({
        type: p.type,
        ticker: String(p.ticker || '').toUpperCase(),
        name: p.name || '',
        quantity: Number(p.quantity) || 0,
        avgPrice: Number(p.avgPrice) || 0,
        currency: p.currency || 'EUR',
        account: p.account || 'Autre',
        importedFrom: 'photo',
        importedAt: G.Store.todayISO()
      });
      n++;
    });
    G.Store.save(true);
    G.UI.closeModal();
    G.UI.toast(`${n} position(s) créée(s). Vérifie les prix de revient, puis lance « Actualiser ».`, 'ok');
    G.UI.renderPortfolio(); G.UI.renderDashboard();
  }

  G.Vision = { openImport, enabled, parse, clean, extract };
})(window);
