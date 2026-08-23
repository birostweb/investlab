/* ============================================================================
   store.js — Persistance du portefeuille sur le volume du conteneur.
   Écritures atomiques (fichier temporaire + rename) pour qu'une coupure de
   courant ou un redémarrage ne puisse jamais laisser un fichier tronqué.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dataDir, log) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'state.json');
    this.cacheFile = path.join(dataDir, 'market-cache.json');
    this.backupDir = path.join(dataDir, 'backups');
    this.log = log || (() => {});
    this._writing = null;
    this._pending = null;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    this._cleanTemp();
  }

  /** Un processus tué en pleine écriture atomique laisse un « .tmp-<pid> ».
   *  Inoffensif, mais cela s'accumule à chaque redéploiement : on balaie
   *  au démarrage. Le fichier définitif, lui, n'est jamais touché. */
  _cleanTemp() {
    try {
      let n = 0;
      for (const f of fs.readdirSync(this.dir)) {
        if (!/\.tmp-\d+$/.test(f)) continue;
        try { fs.unlinkSync(path.join(this.dir, f)); n++; } catch (e) { /* rien */ }
      }
      if (n) this.log(n + ' fichier(s) temporaire(s) d\'une écriture interrompue supprimé(s)');
    } catch (e) { /* rien */ }
  }

  readState() {
    try {
      if (!fs.existsSync(this.file)) return null;
      const raw = fs.readFileSync(this.file, 'utf8');
      if (!raw.trim()) return null;
      return JSON.parse(raw);
    } catch (e) {
      this.log('état illisible (' + e.message + ') — tentative de restauration');
      const restored = this._restoreLatestBackup();
      if (restored) return restored;
      // On ne supprime jamais un fichier corrompu : on l'écarte pour analyse.
      try { fs.renameSync(this.file, this.file + '.corrupt-' + Date.now()); } catch (e2) { /* rien */ }
      return null;
    }
  }

  /** Écriture atomique, sérialisée : un seul write en vol, le dernier état
   *  demandé pendant l'écriture est appliqué juste après (pas d'empilement). */
  writeState(obj) {
    this._pending = obj;
    if (this._writing) return this._writing;
    const flush = async () => {
      while (this._pending !== null) {
        const data = this._pending;
        this._pending = null;
        await this._atomicWrite(this.file, JSON.stringify(data, null, 1));
      }
      this._writing = null;
    };
    this._writing = flush().catch(e => { this._writing = null; throw e; });
    return this._writing;
  }

  async _atomicWrite(target, content) {
    const tmp = target + '.tmp-' + process.pid;
    await fs.promises.writeFile(tmp, content, 'utf8');
    await fs.promises.rename(tmp, target);
  }

  /** Sauvegarde quotidienne, 14 jours conservés. */
  backup() {
    try {
      if (!fs.existsSync(this.file)) return null;
      const day = new Date().toISOString().slice(0, 10);
      const dest = path.join(this.backupDir, `state-${day}.json`);
      if (fs.existsSync(dest)) return dest;
      fs.copyFileSync(this.file, dest);
      const files = fs.readdirSync(this.backupDir)
        .filter(f => /^state-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      while (files.length > 14) {
        const old = files.shift();
        try { fs.unlinkSync(path.join(this.backupDir, old)); } catch (e) { /* rien */ }
      }
      this.log('sauvegarde ' + dest);
      return dest;
    } catch (e) { this.log('sauvegarde impossible : ' + e.message); return null; }
  }

  _restoreLatestBackup() {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(f => /^state-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      while (files.length) {
        const f = files.pop();
        try {
          const obj = JSON.parse(fs.readFileSync(path.join(this.backupDir, f), 'utf8'));
          this.log('état restauré depuis la sauvegarde ' + f);
          return obj;
        } catch (e) { /* sauvegarde précédente */ }
      }
    } catch (e) { /* rien */ }
    return null;
  }

  /* ------------------------------------------------ cache marché persistant */
  readCache() {
    try {
      if (!fs.existsSync(this.cacheFile)) return null;
      return JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
    } catch (e) { return null; }
  }
  writeCache(obj) {
    return this._atomicWrite(this.cacheFile, JSON.stringify(obj))
      .catch(e => this.log('cache non enregistré : ' + e.message));
  }

  stats() {
    let size = 0, mtime = null;
    try { const s = fs.statSync(this.file); size = s.size; mtime = s.mtime.toISOString(); } catch (e) { /* rien */ }
    let backups = 0;
    try { backups = fs.readdirSync(this.backupDir).filter(f => f.startsWith('state-')).length; } catch (e) { /* rien */ }
    return { size, mtime, backups };
  }
}

module.exports = { Store };
