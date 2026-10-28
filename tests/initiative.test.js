// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const initiative = require('../initiative');

// ---------------------------------------------------------------------------
// Ordre d'initiative : tri, tours et rounds, retrait, créatures cachées à la
// table, routes réservées au MJ.
// ---------------------------------------------------------------------------
function verifier(condition, message) {
  if (!condition) throw new Error(message);
}

// --- Modèle ----------------------------------------------------------------------
const entrees = [
  { kind: 'player', entityId: 'p1', nom: 'Jayce', valeur: 12 },
  { kind: 'mob', entityId: 'm1', nom: 'Gobelin', valeur: 15 },
  { kind: 'player', entityId: 'p2', nom: 'Elarion', valeur: 12 },
  { kind: 'mob', entityId: 'm2', nom: 'Assassin', valeur: 20, cache: true },
  { kind: 'mob', entityId: 'm1', nom: 'Doublon', valeur: 99 },
  { kind: 'dragon', entityId: 'x', nom: 'Inconnu', valeur: 50 }
];

verifier(!initiative.demarrer([]).success, 'Un combat sans combattant doit être refusé.');
let { etat } = initiative.demarrer(entrees);
verifier(etat.actif && etat.round === 1 && etat.tour === 0, 'Le combat doit commencer au round 1, premier tour.');
verifier(etat.entrees.map(e => e.nom).join(',') === 'Assassin,Gobelin,Jayce,Elarion',
  `Ordre inattendu : ${etat.entrees.map(e => e.nom).join(',')} (tri décroissant, égalité = ordre saisi, doublons et types inconnus écartés)`);
verifier(etat.entrees[0].cache === true && etat.entrees.find(e => e.nom === 'Jayce').cache === false,
  'Seule une créature peut être cachée.');

// Tours et rounds.
for (let i = 0; i < 4; i++) etat = initiative.suivant(etat).etat;
verifier(etat.tour === 0 && etat.round === 2, 'Après le dernier combattant : premier tour du round suivant.');
etat = initiative.precedent(etat).etat;
verifier(etat.tour === 3 && etat.round === 1, 'Précédent depuis le premier tour : dernier combattant du round précédent.');
etat = initiative.precedent(initiative.precedent(initiative.precedent(etat).etat).etat).etat;
etat = initiative.precedent(etat).etat;
verifier(etat.tour === 0 && etat.round === 1, 'On ne remonte pas avant le premier tour du combat.');

// Retrait : le fil du tour est conservé.
etat = initiative.suivant(initiative.suivant(etat).etat).etat;  // tour de Jayce (index 2)
etat = initiative.retirer(etat, 'mob:m1').etat;                    // Gobelin, avant Jayce
verifier(etat.entrees[etat.tour].nom === 'Jayce', 'Retirer un combattant passé ne doit pas sauter de tour.');
etat = initiative.retirer(etat, 'player:p1').etat;                 // celui qui joue
verifier(etat.entrees[etat.tour].nom === 'Elarion', 'Retirer celui qui joue passe la main au suivant.');
verifier(!initiative.retirer(etat, 'mob:inconnu').success, 'Retirer un inconnu doit échouer.');

// Ordre manuel de la préparation : gardé tel quel, sans tri.
verifier(initiative.demarrer(entrees, { ordreManuel: true }).etat.entrees.map(e => e.nom).join(',') === 'Jayce,Gobelin,Elarion,Assassin',
  'Ordre manuel : le combat doit suivre l\'ordre donné.');

// Ordre changé à la main : celui qui joue garde la main.
{
  let combat = initiative.demarrer(entrees).etat;                     // Assassin, Gobelin, Jayce, Elarion
  combat = initiative.suivant(combat).etat;                          // tour du Gobelin
  combat = initiative.deplacer(combat, 'player:p2', 0).etat;         // Elarion en tête
  verifier(combat.entrees.map(e => e.nom).join(',') === 'Elarion,Assassin,Gobelin,Jayce', 'Déplacer en tête : ordre inattendu.');
  verifier(combat.entrees[combat.tour].nom === 'Gobelin', 'Déplacer un combattant ne doit pas changer qui joue.');
  combat = initiative.deplacer(combat, 'mob:m1', 99).etat;           // position bornée : dernier
  verifier(combat.entrees[3].nom === 'Gobelin' && combat.entrees[combat.tour].nom === 'Gobelin', 'Celui qui joue, déplacé, garde la main.');
  verifier(!initiative.deplacer(combat, 'mob:inconnu', 0).success, 'Déplacer un inconnu doit échouer.');
}

// Projection pour la table.
const table = initiative.projectionTable(initiative.demarrer(entrees).etat);
verifier(!table.entrees.some(e => e.nom === 'Assassin'), 'Une créature cachée ne doit pas apparaître à la table.');
verifier(table.courant === null, 'Quand une créature cachée joue, la table ne voit pas qui joue.');
verifier(!('valeur' in table.entrees[0]) && !('cache' in table.entrees[0]), 'La table ne reçoit ni les valeurs ni les marques.');
const revele = initiative.basculerCache(initiative.demarrer(entrees).etat, 'mob:m2').etat;
verifier(initiative.projectionTable(revele).courant === 'mob:m2', 'Une créature révélée apparaît comme combattant courant.');
verifier(!initiative.basculerCache(revele, 'player:p1').success, 'On ne cache pas un personnage.');

// État relu d'un fichier abîmé.
const repare = initiative.normaliserEtat({ actif: true, tour: 99, round: -3, entrees: [{ kind: 'player', entityId: 'p1' }] });
verifier(repare.tour === 0 && repare.round === 1 && repare.entrees[0].nom === 'p1', 'Un état incohérent doit être corrigé.');
verifier(initiative.normaliserEtat(null).actif === false, 'Sans état : aucun combat.');
console.log('PASS: initiative — tri, tours et rounds, retrait, créatures cachées, état réparé');

// --- Routes (serveur réel) --------------------------------------------------------
const PORT = 3290 + Math.floor(Math.random() * 50);
const BASE = `http://127.0.0.1:${PORT}`;
const MJ = { 'X-ArcaneSync-Role': 'mj', 'X-ArcaneSync-MJ': 'licorne' };

async function appel(methode, route, corps, entetes = {}) {
  const reponse = await fetch(`${BASE}${route}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...entetes },
    body: corps === undefined ? undefined : JSON.stringify(corps)
  });
  return { statut: reponse.status, donnees: await reponse.json().catch(() => null) };
}

(async () => {
  const env = { ...process.env, PORT: String(PORT), ARCANESYNC_MJ_CODE: 'licorne' };
  const serveur = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')],
    { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'ignore', 'pipe'] });
  let erreurs = '';
  serveur.stderr.on('data', d => { erreurs += d; });
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`${BASE}/api/mj/statut`)).ok) break; } catch (_) { /* pas encore prêt */ }
      await new Promise(r => setTimeout(r, 150));
    }
    let r = await appel('POST', '/api/initiative/demarrer', { entrees });
    verifier(r.statut === 403, 'Lancer un combat sans code MJ doit être refusé.');
    r = await appel('POST', '/api/initiative/demarrer', { entrees }, MJ);
    verifier(r.statut === 200 && r.donnees.entrees.length === 4, 'Le MJ doit pouvoir lancer le combat.');

    r = await appel('GET', '/api/initiative');
    verifier(!r.donnees.entrees.some(e => e.nom === 'Assassin') && r.donnees.courant === null,
      'La table ne doit pas voir la créature cachée.');
    r = await appel('GET', '/api/initiative', undefined, MJ);
    verifier(r.donnees.entrees[0].nom === 'Assassin' && r.donnees.entrees[0].valeur === 20, 'Le MJ voit tout.');

    verifier((await appel('POST', '/api/initiative/suivant', {})).statut === 403, 'Avancer sans code MJ doit être refusé.');
    r = await appel('POST', '/api/initiative/suivant', {}, MJ);
    verifier(r.donnees.tour === 1, 'Tour suivant non appliqué.');
    const fichier = JSON.parse(fs.readFileSync(bacDonnees.chemin('session.json'), 'utf8'));
    verifier(fichier.initiative?.tour === 1 && fichier.initiative.actif === true, 'L\'initiative doit être enregistrée dans la partie.');

    verifier((await appel('POST', '/api/initiative/deplacer', { id: 'player:p2', position: 0 })).statut === 403,
      'Changer l\'ordre sans code MJ doit être refusé.');
    r = await appel('POST', '/api/initiative/deplacer', { id: 'player:p2', position: 0 }, MJ);
    verifier(r.statut === 200 && r.donnees.entrees[0].nom === 'Elarion' && r.donnees.entrees[r.donnees.tour].nom === 'Gobelin',
      'Le MJ doit pouvoir changer l\'ordre sans changer qui joue.');

    r = await appel('POST', '/api/initiative/terminer', {}, MJ);
    verifier(r.donnees.actif === false && r.donnees.entrees.length === 0, 'Terminer doit effacer le combat.');

    const page = fs.readFileSync(path.join(__dirname, '..', 'website', 'ecran.html'), 'utf8');
    verifier(page.includes("socket.on('initiativeUpdated'") && page.includes('id="initiative"'), 'L\'Écran doit afficher l\'initiative.');
    const mj = fs.readFileSync(path.join(__dirname, '..', 'website', 'mj.html'), 'utf8');
    verifier(mj.includes('id="initiative-management"') && mj.includes('/api/initiative/'), 'Section Initiative absente de l\'interface MJ.');
    console.log('PASS: initiative — routes MJ, projection de la table, persistance, Écran');
  } catch (erreur) {
    if (erreurs) console.error(erreurs);
    console.error(erreur);
    process.exitCode = 1;
  } finally {
    serveur.kill();
  }
})();
