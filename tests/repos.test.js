// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const repos = require('../repos');

// ---------------------------------------------------------------------------
// Repos court / long : règles normalisées, calcul borné au maximum, routes
// réservées au MJ, règles enregistrées dans la partie.
// ---------------------------------------------------------------------------
function verifier(condition, message) {
  if (!condition) throw new Error(message);
}

// --- Modèle ----------------------------------------------------------------------
const defaut = repos.normaliserRegles(null);
verifier(defaut.court.hp.mode === 'pourcent' && defaut.court.hp.valeur === 50, 'Repos court par défaut : 50 % des PV.');
verifier(defaut.long.hp.mode === 'max' && defaut.long.protection.mode === 'max', 'Repos long par défaut : tout est rendu.');

const abime = repos.normaliserRegles({ court: { hp: { mode: 'pourcent', valeur: 250 }, mana: { mode: 'magie' }, protection: { mode: 'valeur', valeur: -4 } } });
verifier(abime.court.hp.valeur === 100, 'Un pourcentage est borné à 100.');
verifier(abime.court.mana.mode === 'pourcent', 'Un mode inconnu reprend la valeur par défaut.');
verifier(abime.court.protection.valeur === 0, 'Une valeur négative est ramenée à 0.');

const joueur = { hp: { max: 30, current: 10 }, mana: { max: 21, current: 20 }, armure: { protection: { max: 6, current: 0 } } };
let calcul = repos.calculerRepos(joueur, defaut.court);
verifier(calcul.apres.hp === 25 && calcul.apres.mana === 21, `Repos court : PV 10 + 15 = 25, mana borné à 21 (obtenu ${JSON.stringify(calcul.apres)}).`);
verifier(calcul.modifications.hp.current === 25 && !calcul.modifications.armure, 'Seules les ressources qui changent sont envoyées.');
calcul = repos.calculerRepos(joueur, defaut.long);
verifier(calcul.modifications.armure.protection.current === 6 && calcul.apres.hp === 30, 'Repos long : tout au maximum.');
calcul = repos.calculerRepos({ hp: { max: 30, current: 30 }, mana: { max: 0, current: 0 } }, defaut.long);
verifier(calcul.modifications === null, 'Un personnage déjà au maximum n\'est pas modifié.');
calcul = repos.calculerRepos(joueur, { hp: { mode: 'valeur', valeur: 4 }, mana: { mode: 'aucun', valeur: 0 }, protection: { mode: 'aucun', valeur: 0 } });
verifier(calcul.apres.hp === 14 && calcul.apres.mana === 20, 'Mode « points » : rend le nombre de points indiqué.');
console.log('PASS: repos — règles normalisées, calcul borné au maximum');

// --- Routes (serveur réel) --------------------------------------------------------
const PORT = 3340 + Math.floor(Math.random() * 50);
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

    const joueurs = (await appel('GET', '/api/session/players')).donnees;
    verifier(joueurs.length >= 2, 'Le bac à sable doit contenir au moins deux personnages.');
    const [premier, second] = joueurs;
    // Le premier est blessé, le second à terre.
    await appel('POST', '/api/session/player', { id: premier.id, nouvellesDonnees: { hp: { current: 1 }, mana: { current: 0 } } }, MJ);
    await appel('POST', '/api/session/player', { id: second.id, nouvellesDonnees: { hp: { current: 0 } } }, MJ);

    verifier((await appel('GET', '/api/session/repos')).statut === 403, 'Lire les règles sans code MJ doit être refusé.');
    verifier((await appel('POST', '/api/session/repos/long', {})).statut === 403, 'Un repos sans code MJ doit être refusé.');
    verifier((await appel('POST', '/api/session/repos/sieste', {}, MJ)).statut === 400, 'Un type de repos inconnu doit être refusé.');

    // Repos court sur le premier seulement, avec une règle choisie par le MJ.
    const regleCourt = { hp: { mode: 'valeur', valeur: 3 }, mana: { mode: 'max', valeur: 0 }, protection: { mode: 'aucun', valeur: 0 } };
    let r = await appel('POST', '/api/session/repos/court', { regles: { court: regleCourt }, joueurs: [premier.id] }, MJ);
    verifier(r.statut === 200 && r.donnees.resultats.length === 1, 'Le repos court doit modifier un seul personnage.');
    const resultat = r.donnees.resultats[0];
    verifier(resultat.avant.hp === 1 && resultat.apres.hp === Math.min(premier.hp.max, 4), `PV après repos court inattendus : ${JSON.stringify(resultat)}`);
    verifier(resultat.apres.mana === premier.mana.max, 'Le mana doit être rendu en entier.');
    let partie = JSON.parse(fs.readFileSync(bacDonnees.chemin('session.json'), 'utf8'));
    verifier(partie.players[second.id].hp.current === 0, 'Un personnage non choisi ne doit pas être touché.');
    verifier(partie.repos.court.hp.mode === 'valeur' && partie.repos.court.hp.valeur === 3, 'Les règles choisies doivent être enregistrées dans la partie.');
    verifier((await appel('GET', '/api/session/repos', undefined, MJ)).donnees.regles.court.hp.valeur === 3, 'Les règles enregistrées doivent être relues.');

    // Repos long pour tout le monde.
    r = await appel('POST', '/api/session/repos/long', {}, MJ);
    partie = JSON.parse(fs.readFileSync(bacDonnees.chemin('session.json'), 'utf8'));
    verifier(r.statut === 200 && partie.players[second.id].hp.current === partie.players[second.id].hp.max,
      'Le repos long doit remettre tout le groupe au maximum.');
    verifier(Object.values(partie.players).every(j => j.hp.current === j.hp.max), 'Tous les personnages doivent être au maximum.');

    const sources = require('./_sources').sourceServeur();
    verifier(sources.includes("source: roleDepuisRequete(req) === 'mj' ? 'mj' : 'joueur'") && sources.includes("source: 'repos'"),
      'Les mises à jour doivent indiquer leur origine (MJ, joueur, repos).');
    const mj = fs.readFileSync(path.join(__dirname, '..', 'website', 'mj.html'), 'utf8');
    verifier(mj.includes('data-repos="court"') && mj.includes('data-repos="long"') && mj.includes('/api/session/repos/'),
      'Boutons de repos absents de l\'interface MJ.');
    console.log('PASS: repos — routes MJ, personnages choisis, règles enregistrées, origine des mises à jour');
  } catch (erreur) {
    if (erreurs) console.error(erreurs);
    console.error(erreur);
    process.exitCode = 1;
  } finally {
    serveur.kill();
  }
})();
