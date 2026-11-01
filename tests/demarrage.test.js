// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Démarrage sur un fichier de données illisible (V2.3).
//
// Avant : le module concerné démarrait à vide, et le premier enregistrement
// écrasait le fichier. Désormais le serveur refuse de démarrer, ne touche à
// rien (ni au fichier, ni aux sauvegardes) et indique quoi restaurer.
// ---------------------------------------------------------------------------
const RACINE = path.join(__dirname, '..');

function verifier(condition, message) {
  if (!condition) throw new Error(message);
}

/** Copie du bac à sable, avec un fichier éventuellement abîmé. */
function preparerDossier(fichierAbime) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'arcanesync-demarrage-'));
  fs.cpSync(bacDonnees.bacASable, dossier, { recursive: true });
  fs.rmSync(path.join(dossier, 'sauvegardes'), { recursive: true, force: true });
  if (fichierAbime) fs.writeFileSync(path.join(dossier, fichierAbime), '{ "players": { tronqué', 'utf8');
  return dossier;
}

/** Lance server.js ; résout { code, erreurs } à l'arrêt, ou { enLigne: true }. */
function lancer(dossier, port) {
  return new Promise(resoudre => {
    const env = { ...process.env, PORT: String(port), ARCANESYNC_DATA_DIR: dossier };
    delete env.ARCANESYNC_MJ_CODE;
    const serveur = spawn(process.execPath, ['server.js'], { cwd: RACINE, env, stdio: ['ignore', 'ignore', 'pipe'] });
    let erreurs = '';
    serveur.stderr.on('data', d => { erreurs += d; });
    serveur.on('exit', code => resoudre({ code, erreurs }));

    // Témoin : un serveur sain répond ; on l'arrête alors nous-mêmes.
    const debut = Date.now();
    const sonder = async () => {
      if (serveur.exitCode !== null) return;
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/mj/statut`)).ok) {
          serveur.removeAllListeners('exit');
          serveur.once('exit', () => resoudre({ enLigne: true }));
          serveur.kill();
          return;
        }
      } catch (_) { /* pas encore prêt */ }
      if (Date.now() - debut < 12000) setTimeout(sonder, 150);
      else { serveur.kill(); }
    };
    setTimeout(sonder, 150);
  });
}

async function main() {
  const port = 3300 + Math.floor(Math.random() * 50);

  for (const nom of ['session.json', 'data.json', 'maps.json']) {
    const dossier = preparerDossier(nom);
    const avant = fs.readFileSync(path.join(dossier, nom), 'utf8');
    try {
      const resultat = await lancer(dossier, port);
      verifier(!resultat.enLigne && resultat.code === 1, `${nom} illisible : le serveur ne doit pas démarrer (${JSON.stringify(resultat.code)}).`);
      verifier(resultat.erreurs.includes(nom) && resultat.erreurs.includes(path.join('sauvegardes', `${nom}.1`)),
        `${nom} illisible : le message doit nommer le fichier et la sauvegarde à restaurer.\n${resultat.erreurs}`);
      verifier(fs.readFileSync(path.join(dossier, nom), 'utf8') === avant, `${nom} illisible : le fichier ne doit pas être modifié.`);
      verifier(!fs.existsSync(path.join(dossier, 'sauvegardes')), `${nom} illisible : les sauvegardes ne doivent pas tourner.`);
    } finally {
      fs.rmSync(dossier, { recursive: true, force: true });
    }
  }
  console.log('PASS: démarrage — session.json, data.json ou maps.json illisible : arrêt, fichier et sauvegardes intacts');

  // Témoin : les mêmes données, intactes, démarrent normalement.
  const sain = preparerDossier(null);
  try {
    const resultat = await lancer(sain, port + 1);
    verifier(resultat.enLigne, `Données saines : le serveur doit démarrer.\n${resultat.erreurs || ''}`);
  } finally {
    fs.rmSync(sain, { recursive: true, force: true });
  }
  console.log('PASS: démarrage — données saines : le serveur démarre');

  // Garde-fou du module : une écriture vers un fichier illisible est refusée.
  const storage = require('../storage');
  const cible = bacDonnees.chemin('fichier-illisible.json');
  fs.writeFileSync(cible, 'contenu abîmé', 'utf8');
  storage.signalerFichierIllisible(cible, new Error('test'));
  const depot = storage.creerDepot(cible, { etiquette: 'fichier-illisible.json' });
  verifier(depot.ecrire('{}') === false && depot.ecrireDifferee('{}') === false, 'Un fichier illisible ne doit jamais être écrit.');
  verifier(fs.readFileSync(cible, 'utf8') === 'contenu abîmé', 'Le fichier illisible doit rester intact.');
  console.log('PASS: storage — écriture refusée vers un fichier signalé illisible');
}

main().catch(erreur => {
  console.error(erreur);
  process.exit(1);
});
