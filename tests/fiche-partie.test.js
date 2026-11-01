// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Fiche et partie (V2.3).
//
//   1.1 — L'éditeur du MJ enregistre la DÉFINITION (nom, statistiques,
//         maximums...) dans la fiche et l'ÉTAT DE JEU dans la partie. Avant,
//         tout allait dans la partie, et le prochain enregistrement de la
//         fiche effaçait les changements du MJ.
//   1.2 — Révision du personnage : un enregistrement fait depuis une page
//         ouverte avant un autre changement est refusé (409) au lieu de
//         l'effacer.
// ---------------------------------------------------------------------------
const PORT = 3350 + Math.floor(Math.random() * 50);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'dragon';

function verifier(condition, message) {
  if (!condition) throw new Error(message);
}

async function appel(methode, route, corps, { mj = false } = {}) {
  const entetes = { 'Content-Type': 'application/json' };
  if (mj) { entetes['X-ArcaneSync-Role'] = 'mj'; entetes['X-ArcaneSync-MJ'] = CODE; }
  const reponse = await fetch(`${BASE}${route}`, {
    method: methode, headers: entetes, body: corps === undefined ? undefined : JSON.stringify(corps)
  });
  let donnees = null;
  try { donnees = await reponse.json(); } catch (_) {}
  return { statut: reponse.status, donnees };
}

async function attendreServeur() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/api/mj/statut`)).ok) return; } catch (_) { /* pas encore prêt */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('Le serveur de test ne répond pas.');
}

const lireFiche = id => JSON.parse(fs.readFileSync(bacDonnees.chemin('data.json'), 'utf8')).find(j => j.id === id);
const lirePartie = id => JSON.parse(fs.readFileSync(bacDonnees.chemin('session.json'), 'utf8')).players[id];

// --- Séparation définition / état (module pur) ----------------------------------------
{
  const { separerDefinitionEtEtat } = require('../etat-personnage');
  const { definition, etat } = separerDefinitionEtEtat({
    nom: 'A', stats: { force: 3 }, hp: { current: 2, max: 9 }, mana: { current: 1 },
    armure: { type: 'Cuir', durabilite: { current: 4, max: 5 }, protection: { current: 0 } },
    bonus_vie: 1, intox: 2, survie: {}, inventaire: []
  });
  verifier(JSON.stringify(definition) === JSON.stringify({
    nom: 'A', stats: { force: 3 }, hp: { max: 9 }, armure: { type: 'Cuir', durabilite: { max: 5 } }, inventaire: []
  }), `Définition mal séparée : ${JSON.stringify(definition)}`);
  verifier(JSON.stringify(etat) === JSON.stringify({
    hp: { current: 2 }, mana: { current: 1 }, armure: { durabilite: { current: 4 }, protection: { current: 0 } },
    bonus_vie: 1, intox: 2, survie: {}
  }), `État mal séparé : ${JSON.stringify(etat)}`);
}
console.log('PASS: séparation définition / état de jeu');

async function main() {
  const env = { ...process.env, PORT: String(PORT) };
  delete env.ARCANESYNC_MJ_CODE;
  const serveur = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'ignore', 'pipe']
  });
  let erreurs = '';
  serveur.stderr.on('data', d => { erreurs += d; });

  try {
    await attendreServeur();
    verifier((await appel('POST', '/api/mj/code', { nouveau: CODE })).statut === 200, 'Code MJ non défini.');

    const cree = await appel('POST', '/api/joueurs', {
      nom: 'Testeur Fiche', stats: { force: 1, constitution: 20 }, hp: { max: 30, current: 30 },
      mana: { max: 10, current: 10 }, armure: { type: 'Cuir', durabilite: { max: 8, current: 8 }, protection: { max: 4, current: 4 } }
    });
    verifier(cree.statut === 201, `Création refusée (${cree.statut}).`);
    const id = cree.donnees.playerId;
    await appel('GET', `/api/session/player/${id}`);
    // Dégâts en cours de partie.
    await appel('POST', '/api/session/player', { id, nouvellesDonnees: { hp: { current: 12 } } });

    // --- 1.1 : éditeur du MJ ---------------------------------------------------------
    let r = await appel('POST', '/api/session/player', { id, nouvellesDonnees: {
      nom: 'Testeur Renommé', stats: { force: 17, constitution: 20 },
      hp: { max: 40, current: 15 }, mana: { max: 12, current: 10 },
      armure: { type: 'Mailles', durabilite: { max: 9, current: 7 }, protection: { max: 4, current: 4 } },
      inventaire: [{ nom: 'Corde', quantite: 1 }], bio: 'Écrite par le MJ'
    } }, { mj: true });
    verifier(r.statut === 200, `Éditeur MJ refusé (${r.statut} ${JSON.stringify(r.donnees)}).`);
    let fiche = lireFiche(id);
    let partie = lirePartie(id);
    verifier(fiche.nom === 'Testeur Renommé' && fiche.stats.force === 17 && fiche.hp.max === 40 && fiche.armure.type === 'Mailles'
      && fiche.armure.durabilite.max === 9 && fiche.bio === 'Écrite par le MJ' && fiche.inventaire.some(o => o.nom === 'Corde'),
    `1.1 : la définition modifiée par le MJ doit aller dans la fiche (${JSON.stringify({ nom: fiche.nom, force: fiche.stats.force, hpMax: fiche.hp.max })}).`);
    verifier(partie.nom === 'Testeur Renommé' && partie.stats.force === 17 && partie.hp.max === 40 && partie.hp.current === 15
      && partie.armure.durabilite.current === 7, '1.1 : la partie doit suivre la fiche et garder l\'état saisi par le MJ.');

    // Le joueur enregistre ensuite sa fiche telle qu'il la voit : rien n'est perdu.
    const vue = (await appel('GET', `/api/joueurs/${id}`)).donnees;
    r = await appel('POST', '/api/joueur', { id, nouvellesDonnees: vue, revisionAttendue: vue.revision });
    verifier(r.statut === 200, `Enregistrement de la fiche refusé (${r.statut}).`);
    partie = lirePartie(id);
    verifier(partie.stats.force === 17 && partie.hp.max === 40 && partie.hp.current === 15,
      `1.1 : après enregistrement de la fiche, les changements du MJ doivent rester (${partie.stats.force}, ${partie.hp.max}, ${partie.hp.current}).`);
    console.log('PASS: 1.1 — éditeur MJ : définition dans la fiche, état dans la partie, rien de perdu ensuite');

    // Sans code MJ : l'état de jeu seulement, jamais la définition.
    r = await appel('POST', '/api/session/player', { id, nouvellesDonnees: { hp: { max: 999 } } });
    verifier(r.statut === 403, `Un joueur ne doit pas changer ses PV max par la partie (${r.statut}).`);
    const ficheAvant = lireFiche(id);
    r = await appel('POST', '/api/session/player', { id, nouvellesDonnees: { hp: { current: 10 }, armure: { durabilite: { current: 3 } } } });
    verifier(r.statut === 200, `Le joueur doit pouvoir enregistrer son état de jeu (${r.statut}).`);
    verifier(lirePartie(id).armure.durabilite.current === 3 && lirePartie(id).hp.current === 10, 'L\'état de jeu doit aller dans la partie.');
    verifier(JSON.stringify(lireFiche(id)) === JSON.stringify(ficheAvant), 'L\'état de jeu ne doit pas modifier la fiche.');
    console.log('PASS: 1.1 — joueur : état de jeu dans la partie seulement, définition refusée sans code MJ');

    // --- 1.2 : révisions -------------------------------------------------------------
    fiche = lireFiche(id);
    const revision = fiche.revision;
    verifier(Number.isInteger(revision) && revision > 0, `La fiche doit porter une révision (${revision}).`);

    // Une page ouverte AVANT un changement fait ailleurs.
    const perimee = revision;
    r = await appel('POST', '/api/session/player', { id, nouvellesDonnees: { inventaire: [{ nom: 'Potion du MJ', quantite: 1 }] } }, { mj: true });
    verifier(r.statut === 200 && lireFiche(id).revision === revision + 1, 'Une modification de définition doit augmenter la révision.');
    r = await appel('POST', '/api/joueur', { id, nouvellesDonnees: { ...vue, inventaire: [] }, revisionAttendue: perimee });
    verifier(r.statut === 409 && r.donnees.conflit === true, `1.2 : un enregistrement périmé doit être refusé (${r.statut}).`);
    verifier(lireFiche(id).inventaire.some(o => o.nom === 'Potion du MJ'), '1.2 : le changement fait ailleurs doit être conservé.');

    // À jour : accepté, et la nouvelle révision est renvoyée.
    r = await appel('POST', '/api/joueur', { id, nouvellesDonnees: { bio: 'À jour' }, revisionAttendue: revision + 1 });
    verifier(r.statut === 200 && r.donnees.revision === revision + 2, `1.2 : un enregistrement à jour doit passer (${r.statut} ${JSON.stringify(r.donnees)}).`);

    // Éditeur MJ ouvert avant un enregistrement du joueur : refusé aussi.
    r = await appel('POST', '/api/session/player', { id, nouvellesDonnees: { stats: { force: 2 } }, revisionAttendue: revision }, { mj: true });
    verifier(r.statut === 409 && lireFiche(id).stats.force === 17, `1.2 : l'éditeur MJ périmé doit être refusé (${r.statut}).`);

    // Les notes personnelles ne rendent pas la fiche ouverte périmée.
    const avantNotes = lireFiche(id).revision;
    await appel('PUT', `/api/session/player/${id}/personal-notes`, { role: 'player', playerId: id, content: 'Note' });
    verifier(lireFiche(id).revision === avantNotes, 'Les notes personnelles ne doivent pas changer la révision.');

    // Anciens appels sans révision : acceptés.
    r = await appel('POST', '/api/joueur', { id, nouvellesDonnees: { bio: 'Sans révision' } });
    verifier(r.statut === 200, 'Un enregistrement sans révision indiquée doit rester accepté.');
    console.log('PASS: 1.2 — révisions : enregistrement périmé refusé (fiche et éditeur MJ), à jour accepté, notes neutres');
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
