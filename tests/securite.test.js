// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Confidentialité et validation des données (V2.1.2).
//
//   - affichages des pages : les valeurs saisies par un joueur sont échappées ;
//   - notes personnelles et anciens messages privés : jamais dans les listes
//     ni les diffusions reçues par toute la table ;
// Le serveur réel est lancé sur un port dédié, avec les données du bac à sable.
// ---------------------------------------------------------------------------
const PORT = 3250 + Math.floor(Math.random() * 50);
const BASE = `http://127.0.0.1:${PORT}`;

function verifier(condition, message) {
  if (!condition) throw new Error(message);
}

const source = (...segments) => fs.readFileSync(path.join(__dirname, '..', ...segments), 'utf8');

async function appel(methode, route, { corps, role } = {}) {
  const entetes = { 'Content-Type': 'application/json' };
  if (role) entetes['X-ArcaneSync-Role'] = role;
  const reponse = await fetch(`${BASE}${route}`, {
    method: methode,
    headers: entetes,
    body: corps === undefined ? undefined : JSON.stringify(corps)
  });
  let donnees = null;
  try { donnees = await reponse.json(); } catch (_) {}
  return { statut: reponse.status, donnees };
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

const contientPrive = objet => JSON.stringify(objet).includes('personalNotes')
  || JSON.stringify(objet).includes('privateMessages');

// --- Affichages échappés (sources des pages) ----------------------------------------
{
  const mj = source('website', 'mj.html');
  verifier(!mj.includes('${joueur.bonus_vie ?? 0}') && !mj.includes('${joueur.intox ?? 0}'),
    'mj.html : vie bonus et intoxication doivent être échappées.');
  verifier(!mj.includes('<strong>${t.nom}</strong>'), 'mj.html : le nom des modèles de mobs doit être échappé.');

  const selection = source('website', 'selecte_player.html');
  verifier(!selection.includes('${joueur.hp?.current || 0}') && !selection.includes('${joueur.mana?.max || 0}'),
    'selecte_player.html : PV et mana doivent être échappés.');

  const carte = source('website', 'map.html');
  verifier(!carte.includes("${token.entity?.hp?.current ?? '?'}"), 'map.html : les PV des jetons doivent être échappés.');
}
console.log('PASS: affichages — valeurs saisies par les joueurs échappées (MJ, choix du personnage, carte)');

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
    const joueurs = JSON.parse(fs.readFileSync(bacDonnees.chemin('data.json'), 'utf8'));
    const joueur = joueurs[0];

    // --- Notes personnelles : seulement par leur route ---------------------------------
    let r = await appel('PUT', `/api/session/player/${joueur.id}/personal-notes`, {
      corps: { role: 'player', playerId: joueur.id, content: 'Secret : la clé est sous le tonneau.' }
    });
    verifier(r.statut === 200, `Le joueur doit pouvoir écrire ses notes (${r.statut}).`);

    for (const route of ['/api/joueurs', `/api/joueurs/${joueur.id}`, '/api/session/players', `/api/session/player/${joueur.id}`]) {
      r = await appel('GET', route);
      verifier(r.statut === 200, `${route} : ${r.statut}`);
      verifier(!contientPrive(r.donnees), `${route} ne doit contenir ni notes personnelles ni messages privés.`);
    }

    r = await appel('POST', '/api/session/player', { corps: { id: joueur.id, nouvellesDonnees: { hp: { current: 1 } } } });
    verifier(r.statut === 200 && !contientPrive(r.donnees), "La réponse d'enregistrement ne doit pas contenir les notes.");

    r = await appel('GET', `/api/session/player/${joueur.id}/personal-notes?role=player&playerId=${joueur.id}`);
    verifier(r.donnees?.content === 'Secret : la clé est sous le tonneau.', 'Le joueur doit toujours lire ses notes.');
    r = await appel('GET', `/api/session/player/${joueur.id}/personal-notes?role=mj`, { role: 'mj' });
    verifier(r.donnees?.content === 'Secret : la clé est sous le tonneau.', 'Le MJ doit toujours lire les notes.');

    // L'export (sauvegarde du MJ) reste complet.
    r = await appel('GET', '/api/session/export', { role: 'mj' });
    verifier(r.statut === 200 && r.donnees.session.players[joueur.id].personalNotes === 'Secret : la clé est sous le tonneau.',
      "L'export de la partie doit conserver les notes personnelles.");
    const fiche = JSON.parse(fs.readFileSync(bacDonnees.chemin('data.json'), 'utf8')).find(j => j.id === joueur.id);
    verifier(fiche.personalNotes === 'Secret : la clé est sous le tonneau.', 'Les notes doivent rester enregistrées dans la fiche.');
    console.log('PASS: confidentialité — notes personnelles et messages privés absents des listes, export complet');

    // --- Valeurs numériques : intoxication bornée par la Constitution -------------------
    const lireSession = id => JSON.parse(fs.readFileSync(bacDonnees.chemin('session.json'), 'utf8')).players[id];
    const lireFiche = id => JSON.parse(fs.readFileSync(bacDonnees.chemin('data.json'), 'utf8')).find(j => j.id === id);

    r = await appel('POST', '/api/joueurs', { corps: {
      nom: 'Testeur Intox', stats: { constitution: '30', force: 'abc' }, intox: '12', bonus_vie: '-3',
      hp: { max: 'n/a', current: 5 }, mana: { max: 10, current: 10 }
    } });
    verifier(r.statut === 201, `Création refusée (${r.statut}).`);
    const idIntox = r.donnees.playerId;
    const creee = lireFiche(idIntox);
    verifier(creee.intox === 12 && creee.stats.constitution === 30 && creee.stats.force === 0,
      `Création : intoxication et statistiques doivent être des nombres (${JSON.stringify([creee.intox, creee.stats])}).`);
    verifier(creee.hp.max === 0 && creee.hp.current === 0 && creee.bonus_vie === 0,
      'Création : un PV maximum invalide vaut 0, la vie bonus ne peut pas être négative.');

    const enregistrerEtat = nouvellesDonnees => appel('POST', '/api/session/player', { corps: { id: idIntox, nouvellesDonnees } });
    await enregistrerEtat({ intox: '50' });
    verifier(lireSession(idIntox).intox === 30, `L'intoxication doit être bornée à la Constitution (${lireSession(idIntox).intox}).`);
    await enregistrerEtat({ intox: '-4' });
    verifier(lireSession(idIntox).intox === 0, "L'intoxication ne peut pas être négative.");
    await enregistrerEtat({ intox: '25' });
    verifier(lireSession(idIntox).intox === 25, "Une intoxication en texte (« 25 ») doit être enregistrée en nombre.");

    // La Constitution baisse sur la fiche : l'intoxication de la partie suit.
    r = await appel('POST', '/api/joueur', { corps: { id: idIntox, nouvellesDonnees: { stats: { constitution: 20 } } } });
    verifier(r.statut === 200, `Enregistrement de fiche refusé (${r.statut}).`);
    verifier(lireSession(idIntox).intox === 20, `Après baisse de la Constitution, l'intoxication doit être rebornée (${lireSession(idIntox).intox}).`);

    // Une Constitution de 0 ne borne pas.
    r = await appel('POST', '/api/joueurs', { corps: { nom: 'Testeur Sans Constitution', stats: { constitution: 0 }, intox: 80 } });
    verifier(lireFiche(r.donnees.playerId).intox === 80, 'Constitution à 0 : l\'intoxication ne doit pas être bornée.');
    console.log('PASS: valeurs numériques — nombres enregistrés, intoxication bornée par la Constitution (0 = sans borne)');

    // --- Suppression : la partie et l'initiative suivent --------------------------------
    r = await appel('POST', '/api/mobs', { corps: { nom: 'Gobelin du test', hp: { max: 7, current: 7 } }, role: 'mj' });
    verifier(r.statut === 201, `Création du mob refusée (${r.statut}).`);
    const idMob = r.donnees.mob.id;
    r = await appel('POST', '/api/initiative/demarrer', { role: 'mj', corps: { entrees: [
      { kind: 'player', entityId: idIntox, nom: 'Testeur Intox', valeur: 15 },
      { kind: 'mob', entityId: idMob, nom: 'Gobelin du test', valeur: 12 },
      { kind: 'player', entityId: joueur.id, nom: joueur.nom, valeur: 8 }
    ] } });
    verifier(r.statut === 200 && r.donnees.entrees.length === 3, `Initiative non démarrée (${r.statut}).`);

    r = await appel('DELETE', `/api/joueurs/delete/${idIntox}`, { role: 'mj' });
    verifier(r.statut === 200, `Suppression du personnage refusée (${r.statut}).`);
    verifier(!lireSession(idIntox), "L'état de partie d'un personnage supprimé doit disparaître.");
    r = await appel('GET', '/api/initiative', { role: 'mj' });
    verifier(!r.donnees.entrees.some(e => e.entityId === idIntox), "Un personnage supprimé doit quitter l'initiative.");
    verifier(r.donnees.actif && r.donnees.entrees.length === 2, "Le combat doit continuer avec les autres combattants.");

    r = await appel('DELETE', `/api/mobs/${idMob}`, { role: 'mj' });
    verifier(r.statut === 200, `Suppression du mob refusée (${r.statut}).`);
    r = await appel('GET', '/api/initiative', { role: 'mj' });
    verifier(!r.donnees.entrees.some(e => e.entityId === idMob), "Un mob supprimé doit quitter l'initiative.");

    // Plus aucun personnage inconnu : l'export se réimporte.
    r = await appel('GET', '/api/session/export', { role: 'mj' });
    r = await appel('POST', '/api/session/import', { corps: r.donnees, role: 'mj' });
    verifier(r.statut === 200, `Après suppression, l'export doit se réimporter (${r.statut} ${JSON.stringify(r.donnees)}).`);
    console.log('PASS: suppression — état de partie et initiative nettoyés, export réimportable');
  } catch (erreur) {
    if (erreurs) console.error(erreurs);
    throw erreur;
  } finally {
    serveur.kill();
  }
}

main().catch(erreur => {
  console.error(erreur);
  process.exit(1);
});
