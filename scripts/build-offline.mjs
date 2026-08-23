/* ============================================================================
   build-offline.mjs — Génère MonInvestisseurIA.html, la version « un seul
   fichier » : CSS, JS et polices intégrés, ouvrable hors ligne d'un double-clic.

   Équivalent multiplateforme de build.ps1 (macOS, Linux, Windows).
   Usage :  npm run build:offline
   ========================================================================== */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');

/* L'ordre doit rester celui déclaré dans index.html : les modules se
   référencent au chargement (data.js avant store.js, etc.). */
const ORDER = ['api.js', 'data.js', 'store.js', 'market.js', 'engine.js',
               'agent.js', 'charts.js', 'ui.js', 'main.js'];

let html = await readFile(path.join(pub, 'index.html'), 'utf8');
let css = await readFile(path.join(pub, 'css', 'app.css'), 'utf8');

/* --- Polices en data: URI, pour que le fichier reste autonome ------------ */
const fontDir = path.join(pub, 'fonts');
let fonts = 0;
if (existsSync(fontDir)) {
  for (const name of (await readdir(fontDir)).filter(f => f.endsWith('.woff2'))) {
    const b64 = (await readFile(path.join(fontDir, name))).toString('base64');
    const before = css;
    css = css.replaceAll('../fonts/' + name, 'data:font/woff2;base64,' + b64);
    if (css !== before) fonts++;
  }
}

/* --- Concaténation des scripts ------------------------------------------ */
let js = '';
for (const f of ORDER) {
  const p = path.join(pub, 'js', f);
  if (!existsSync(p)) throw new Error('Fichier introuvable : ' + p);
  js += `\n/* ===== ${f} ===== */\n` + await readFile(p, 'utf8') + '\n';
}

/* --- Inlining ------------------------------------------------------------
   `$` a un sens spécial dans les remplacements de String.replace : on passe
   donc une fonction, sinon « $& » dans le code serait réinterprété.        */
const linkRe = /^[ \t]*<link rel="stylesheet" href="css\/app\.css">[ \t]*$/m;
if (!linkRe.test(html)) throw new Error("Balise <link> de la feuille de style introuvable dans index.html");
html = html.replace(linkRe, () => '<style>\n' + css + '\n</style>');

const scriptsRe = /<script src="js\/api\.js"><\/script>[\s\S]*?<script src="js\/main\.js"><\/script>/;
if (!scriptsRe.test(html)) throw new Error('Bloc des balises <script> introuvable dans index.html');
html = html.replace(scriptsRe, () => '<script>\n' + js + '\n</script>');

if (/<script src=/.test(html) || /<link rel="stylesheet"/.test(html)) {
  throw new Error("L'inlining a échoué : il reste des références externes.");
}

const out = path.join(root, 'MonInvestisseurIA.html');
await writeFile(out, html, 'utf8');

const ko = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`  polices intégrées : ${fonts}`);
console.log(`  scripts intégrés  : ${ORDER.length}`);
console.log(`\n  ✓ MonInvestisseurIA.html généré (${ko} Ko) — version hors ligne.\n`);
