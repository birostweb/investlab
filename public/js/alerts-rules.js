/* ============================================================================
   alerts.js — Évaluation des alertes de prix.

   Fonctions PURES, sans aucun import. SOURCE UNIQUE : ce fichier est chargé
   tel quel par le navigateur (balise <script>) et par le serveur
   (`require('../public/js/alerts-rules')`). Une seule copie, donc aucune
   dérive possible — deux évaluations divergentes seraient pires que pas
   d'alerte du tout.
   ========================================================================== */
'use strict';

/** Le seuil est-il franchi ? `above` : le cours l'atteint ou le dépasse. */
function crosses(alert, price) {
  if (!alert || !alert.active || alert.triggeredAt) return false;
  const seuil = Number(alert.price);
  const p = Number(price);
  if (!isFinite(seuil) || !isFinite(p) || seuil <= 0 || p <= 0) return false;
  return alert.kind === 'below' ? p <= seuil : p >= seuil;
}

/**
 * Évalue toutes les alertes contre les cours fournis.
 * @param {Array}  alerts  le tableau d'alertes (MUTÉ : triggeredAt renseigné)
 * @param {Object} prices  { TICKER: prix }
 * @param {string} nowISO  horodatage à inscrire
 * @returns {Array} les alertes nouvellement déclenchées
 */
function evaluate(alerts, prices, nowISO) {
  const fired = [];
  if (!Array.isArray(alerts)) return fired;
  for (const a of alerts) {
    if (!a || !a.ticker) continue;
    const p = prices[String(a.ticker).toUpperCase()];
    if (p === undefined || p === null) continue;
    if (!crosses(a, p)) continue;
    a.triggeredAt = nowISO || new Date().toISOString();
    a.triggeredPrice = Number(p);
    a.seen = false;
    fired.push(a);
  }
  return fired;
}

/** Phrase lisible, utilisée dans les journaux comme dans les notifications. */
function describe(a) {
  const sens = a.kind === 'below' ? 'est descendu à' : 'a atteint';
  const seuil = a.kind === 'below' ? 'sous' : 'au-dessus de';
  return a.triggeredPrice != null
    ? `${a.ticker} ${sens} ${fmt(a.triggeredPrice)} € (seuil ${seuil} ${fmt(a.price)} €)`
    : `${a.ticker} ${seuil} ${fmt(a.price)} €`;
}
function fmt(n) {
  const v = Number(n);
  if (!isFinite(v)) return '—';
  // les cryptos vont de 0,05 € à 60 000 € : on adapte les décimales
  const d = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 1 ? 2 : 4;
  return v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

const API = { crosses, evaluate, describe, fmt };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.AlertRules = API;
