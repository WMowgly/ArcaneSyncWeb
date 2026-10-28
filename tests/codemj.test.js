// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Code MJ : le rôle MJ n'est accordé qu'avec le code, dès qu'il est défini.
// Le serveur réel est lancé sur un port dédié, avec les données du bac à sable.
// ---------------------------------------------------------------------------
const PORT = 3190 + Math.floor(Math.random() * 50);
const BASE = `http://127.0.0.1:${PORT}`;

function verifier(condition, message) {
  if (!condition) throw new Error(message);
}

async function appel(methode, route, { corps, code, role } = {}) {
  const entetes = { 'Content-Type': 'application/json' };
  if (code) entetes['X-ArcaneSync-MJ'] = code;
  if (role) entetes['X-ArcaneSync-Role'] = role;
  const reponse = await fetch(`${BASE}${route}`, {
    method: methode,
    headers: entetes,
    body: corps === undefined ? undefined : JSON.stringify(corps)
  });
  let donnees = null;
  try { donnees = await reponse.json(); } catch (_) {}
  return { statut: reponse.status, requis: reponse.headers.get('X-ArcaneSync-MJ') === 'requis', donnees };
}

async function attendreServeur() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/mj/statut`)).ok) return;
    } catch (_) { /* pas encore prêt */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('Le serveur de test ne répond pas.');
}

async function main() {
  const env = { ...process.env, PORT: String(PORT) };
  delete env.ARCANESYNC_MJ_CODE;
  const serveur = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let erreurs = '';
  serveur.stderr.on('data', d => { erreurs += d; });

  try {
    await attendreServeur();
    const joueur = JSON.parse(fs.readFileSync(bacDonnees.chemin('data.json'), 'utf8'))[0];

    // --- Sans code défini : comportement historique (rôle déclaré) ----------
    let r = await appel('GET', '/api/mj/statut');
    verifier(r.donnees.configure === false, 'Aucun code ne devrait être défini au départ.');
    r = await appel('GET', '/api/mobs', { role: 'mj' });
    verifier(r.statut === 200, `Mode ouvert : le MJ déclaré doit être accepté (${r.statut}).`);
    r = await appel('GET', '/api/mobs');
    verifier(r.statut === 403 && r.requis, 'Les mobs ne doivent pas être lisibles par un joueur.');

    // --- Définition du code --------------------------------------------------
    r = await appel('POST', '/api/mj/code', { corps: { nouveau: 'abc' } });
    verifier(r.statut === 400, 'Un code trop court doit être refusé.');
    r = await appel('POST', '/api/mj/code', { corps: { nouveau: 'dragon' } });
    verifier(r.statut === 200, `Définition du code refusée : ${JSON.stringify(r.donnees)}`);
    r = await appel('GET', '/api/mj/statut');
    verifier(r.donnees.configure === true && r.donnees.source === 'fichier', 'Le code devrait être défini (fichier).');
    const fichier = fs.readFileSync(bacDonnees.chemin('mj.json'), 'utf8');
    verifier(!fichier.includes('dragon'), 'Le code ne doit jamais être stocké en clair.');
    r = await appel('POST', '/api/mj/code', { corps: { nouveau: 'usurpateur' } });
    verifier(r.statut === 400, 'Changer le code sans le code actuel doit être refusé.');

    // --- Vérification ----------------------------------------------------------
    verifier((await appel('POST', '/api/mj/verifier', { corps: { code: 'dragon' } })).donnees.valide === true, 'Bon code non reconnu.');
    verifier((await appel('POST', '/api/mj/verifier', { corps: { code: 'Dragon' } })).donnees.valide === false, 'Mauvais code accepté.');

    // --- Routes MJ -------------------------------------------------------------
    r = await appel('GET', '/api/mobs', { role: 'mj' });
    verifier(r.statut === 403 && r.requis, 'Rôle MJ déclaré sans code : doit être refusé.');
    r = await appel('GET', '/api/mobs', { role: 'mj', code: 'faux-code' });
    verifier(r.statut === 403, 'Mauvais code : doit être refusé.');
    r = await appel('GET', '/api/mobs', { role: 'mj', code: 'dragon' });
    verifier(r.statut === 200, 'Bon code : doit être accepté.');
    r = await appel('POST', '/api/mobs', { corps: { nom: 'Gobelin intrus' }, role: 'mj' });
    verifier(r.statut === 403, 'Création de mob sans code : doit être refusée.');
    r = await appel('GET', '/api/session/export', { corps: undefined, role: 'mj' });
    verifier(r.statut === 403, 'Export de la partie sans code : doit être refusé.');
    r = await appel('POST', '/api/session/scene/reset', { corps: { role: 'mj' } });
    verifier(r.statut === 403, 'Rôle MJ dans le corps sans code : doit être refusé.');
    r = await appel('DELETE', `/api/joueurs/delete/${joueur.id}`, { corps: { role: 'mj' } });
    verifier(r.statut === 403, 'Suppression de personnage sans code : doit être refusée.');
    r = await appel('GET', '/api/maps?role=mj');
    verifier(r.statut === 403, 'Bibliothèque de cartes sans code : doit être refusée.');
    r = await appel('GET', '/api/maps?role=mj', { code: 'dragon' });
    verifier(r.statut === 200, 'Bibliothèque de cartes avec le code : doit être acceptée.');

    // --- État de session : le joueur garde la main sur son état de jeu --------
    r = await appel('POST', '/api/session/player', { corps: { id: joueur.id, nouvellesDonnees: { hp: { current: 1 } } } });
    verifier(r.statut === 200, `Le joueur doit pouvoir enregistrer ses PV (${r.statut}).`);
    r = await appel('POST', '/api/session/player', {
      corps: { id: joueur.id, nouvellesDonnees: { survie: { reussi: [true, false, false], echec: [false, false, false] } } }
    });
    verifier(r.statut === 200, 'Le joueur doit pouvoir enregistrer ses jets de survie.');
    r = await appel('POST', '/api/session/player', { corps: { id: joueur.id, nouvellesDonnees: { stats: { force: 99 } } } });
    verifier(r.statut === 403, 'Un joueur ne doit pas modifier ses statistiques via la session.');
    r = await appel('POST', '/api/session/player', { corps: { id: joueur.id, nouvellesDonnees: { stats: { force: 3 } } }, role: 'mj', code: 'dragon' });
    verifier(r.statut === 200, 'Le MJ doit pouvoir modifier les statistiques.');

    // --- Changement de code ------------------------------------------------------
    r = await appel('POST', '/api/mj/code', { corps: { actuel: 'dragon', nouveau: 'griffon' } });
    verifier(r.statut === 200, 'Changement de code avec le code actuel refusé.');
    r = await appel('GET', '/api/mobs', { role: 'mj', code: 'dragon' });
    verifier(r.statut === 403, "L'ancien code ne doit plus être accepté.");
    r = await appel('GET', '/api/mobs', { role: 'mj', code: 'griffon' });
    verifier(r.statut === 200, 'Le nouveau code doit être accepté.');
  } catch (erreur) {
    if (erreurs) console.error(erreurs);
    throw erreur;
  } finally {
    serveur.kill();
  }

  // --- Code fixé par l'environnement ---------------------------------------------
  process.env.ARCANESYNC_MJ_CODE = 'licorne';
  const mjCode = require('../mjcode');
  verifier(mjCode.source() === 'env', 'La variable ARCANESYNC_MJ_CODE doit faire foi.');
  verifier(mjCode.verifier('licorne') && !mjCode.verifier('griffon'), 'Le code d\'environnement doit primer sur le fichier.');
  verifier(!mjCode.definir('nouveau-code', 'licorne').success, 'Un code d\'environnement ne se change pas depuis l\'interface.');
  delete process.env.ARCANESYNC_MJ_CODE;

  // --- Sources : pages et sockets ---------------------------------------------------
  const serveurSource = require('./_sources').sourceServeur();
  verifier(serveurSource.includes('io.use((socket, next)') && serveurSource.includes('socket.handshake.auth?.mjCode'),
    'Le rôle MJ des sockets doit exiger le code.');
  for (const page of ['mj.html', 'map.html', 'modification.html', 'tableau.html', 'selecte_player.html', 'index.html']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'website', page), 'utf8');
    verifier(source.includes('<script src="mj-code.js"></script>'), `${page} doit charger mj-code.js.`);
  }

  console.log('PASS: code MJ — définition, vérification, routes MJ protégées, état de jeu joueur, changement, environnement');
}

main().catch(erreur => {
  console.error(erreur);
  process.exit(1);
});
