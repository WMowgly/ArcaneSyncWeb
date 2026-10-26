// tests/_donnees.js
// ---------------------------------------------------------------------------
// ArcaneSync V1.13.9 — Bac à sable de données pour les suites de tests.
//
// POURQUOI
// --------
// Jusqu'ici, chaque suite écrivait DANS LA PARTIE EN COURS. La seule
// protection était une sauvegarde du fichier au début et une restauration
// dans un `finally`. Ce filet a cédé deux fois pendant le développement :
//
//   - un test de permission d'import a réellement remplacé session.json,
//     faisant perdre activeMapId ;
//   - une carte `__TEST_ANNOT__` a été ressuscitée APRÈS la restauration,
//     par le vidage différé déclenché à l'arrêt du processus.
//
// Un `finally` ne protège de rien contre une écriture qui arrive après lui.
//
// CE QUE FAIT CE MODULE
// ---------------------
// Il redirige TOUTES les données vers un dossier temporaire, amorcé avec une
// COPIE des fichiers réels. Les suites gardent donc exactement les mêmes
// attentes qu'avant — mêmes cartes, même session — mais aucune écriture ne
// peut plus atteindre la partie.
//
// IMPÉRATIF : ce module doit être requis EN PREMIER, avant tout `require`
// d'un module applicatif. storage.js lit ARCANESYNC_DATA_DIR au chargement
// des modules appelants ; posée trop tard, la variable n'aurait aucun effet.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');

const racine = path.join(__dirname, '..');

// tableau.json et database/ sont copiés eux aussi : server.js les lit, et une
// suite pourrait un jour le charger.
const FICHIERS = [
  'data.json',
  'session.json',
  'maps.json',
  'mob_templates.json',
  'tableau.json'
];

// Un dossier par processus : `npm test` enchaîne les suites, et deux exécutions
// simultanées ne doivent pas se marcher dessus.
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'arcanesync-test-'));

FICHIERS.forEach(nom => {
  const source = path.join(racine, nom);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(bacASable, nom));
});

['game_database.json', 'sorts.json'].forEach(nom => {
  const source = path.join(racine, 'database', nom);
  if (fs.existsSync(source)) {
    fs.mkdirSync(path.join(bacASable, 'database'), { recursive: true });
    fs.copyFileSync(source, path.join(bacASable, 'database', nom));
  }
});

process.env.ARCANESYNC_DATA_DIR = bacASable;

// Ménage à l'arrêt. L'ordre compte : ce gestionnaire est enregistré AVANT
// ceux de storage.js (installés à la création du premier dépôt), donc il
// s'exécute avant eux. On annule les écritures en attente d'abord, sinon le
// vidage de storage tenterait d'écrire dans un dossier qui n'existe plus.
process.on('exit', () => {
  try { require('../storage').annulerTout(); } catch (_) {}
  try { fs.rmSync(bacASable, { recursive: true, force: true }); } catch (_) {}
});

module.exports = {
  bacASable,
  chemin: (...segments) => path.join(bacASable, ...segments)
};
