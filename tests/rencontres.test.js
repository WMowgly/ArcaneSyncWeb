// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Rencontres préparées (V2.4) : modèle, routes réservées au MJ, déploiement
// sur la carte (placement groupé, embuscade, initiative).
// ---------------------------------------------------------------------------
function verifier(condition, message) {
  if (!condition) throw new Error(message);
}

// --- Modèle ------------------------------------------------------------------------------
{
  const { normaliserRencontre } = require('../rencontres');
  const r = normaliserRencontre({
    nom: '  Embuscade  ', notes: 'Au pont',
    groupes: [{ templateId: 't1', quantite: '3', initiative: '12' }, { templateId: '', quantite: 2 }, { templateId: 't2', quantite: 99, initiative: 'abc' }]
  });
  verifier(r.nom === 'Embuscade' && r.groupes.length === 2, 'Rencontre : nom nettoyé, lignes sans modèle retirées.');
  verifier(r.groupes[0].quantite === 3 && r.groupes[0].initiative === 12, 'Rencontre : quantité et initiative en nombres.');
  verifier(r.groupes[1].quantite === 20 && r.groupes[1].initiative === null, 'Rencontre : quantité plafonnée, initiative invalide = null.');
}
console.log('PASS: rencontres — modèle (lignes, quantités, initiative)');

const PORT = 3450 + Math.floor(Math.random() * 50);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'dragon';

async function appel(methode, route, corps, { mj = false } = {}) {
  const entetes = { 'Content-Type': 'application/json' };
  if (mj) { entetes['X-ArcaneSync-Role'] = 'mj'; entetes['X-ArcaneSync-MJ'] = CODE; }
  const reponse = await fetch(`${BASE}${route}`, { method: methode, headers: entetes, body: corps === undefined ? undefined : JSON.stringify(corps) });
  let donnees = null;
  try { donnees = await reponse.json(); } catch (_) {}
  return { statut: reponse.status, donnees };
}

async function main() {
  const env = { ...process.env, PORT: String(PORT) };
  delete env.ARCANESYNC_MJ_CODE;
  const serveur = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'ignore', 'pipe']
  });
  let erreurs = '';
  serveur.stderr.on('data', d => { erreurs += d; });
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`${BASE}/api/mj/statut`)).ok) break; } catch (_) { /* pas encore prêt */ }
      await new Promise(r => setTimeout(r, 150));
    }
    verifier((await appel('POST', '/api/mj/code', { nouveau: CODE })).statut === 200, 'Code MJ non défini.');

    // Bestiaire : deux modèles.
    const gobelin = (await appel('POST', '/api/mob-templates', { nom: 'Gobelin', hp: { max: 7, current: 7 } }, { mj: true })).donnees.template;
    const chef = (await appel('POST', '/api/mob-templates', { nom: 'Chef gobelin', hp: { max: 15, current: 15 } }, { mj: true })).donnees.template;
    verifier(gobelin?.id && chef?.id, 'Préparation : modèles du bestiaire.');

    // --- Gestion : réservée au MJ --------------------------------------------------------
    verifier((await appel('GET', '/api/rencontres')).statut === 403, 'Lister les rencontres : réservé au MJ.');
    verifier((await appel('POST', '/api/rencontres', { nom: 'X', groupes: [{ templateId: gobelin.id }] })).statut === 403, 'Créer : réservé au MJ.');
    let r = await appel('POST', '/api/rencontres', { nom: 'Vide', groupes: [] }, { mj: true });
    verifier(r.statut === 400, 'Une rencontre sans créature est refusée.');
    r = await appel('POST', '/api/rencontres', {
      nom: 'Embuscade gobeline', notes: 'Sous le pont',
      groupes: [{ templateId: gobelin.id, quantite: 3, initiative: 14 }, { templateId: chef.id, quantite: 1, initiative: 8 }]
    }, { mj: true });
    verifier(r.statut === 201 && r.donnees.rencontre.groupes.length === 2, `Création refusée (${r.statut}).`);
    const rencontre = r.donnees.rencontre;
    verifier(JSON.parse(fs.readFileSync(bacDonnees.chemin('rencontres.json'), 'utf8')).length === 1, 'La rencontre doit être enregistrée dans rencontres.json.');
    r = await appel('PUT', `/api/rencontres/${rencontre.id}`, { notes: 'Sous le vieux pont' }, { mj: true });
    verifier(r.statut === 200 && r.donnees.rencontre.notes === 'Sous le vieux pont' && r.donnees.rencontre.groupes.length === 2, 'Modification refusée.');
    r = await appel('POST', `/api/rencontres/${rencontre.id}/duplicate`, {}, { mj: true });
    verifier(r.statut === 201 && r.donnees.rencontre.nom === 'Embuscade gobeline (copie)', 'Duplication refusée.');
    verifier((await appel('DELETE', `/api/rencontres/${r.donnees.rencontre.id}`, undefined, { mj: true })).statut === 200, 'Suppression refusée.');
    console.log('PASS: rencontres — gestion réservée au MJ (créer, modifier, dupliquer, supprimer)');

    // --- Déploiement hors combat : placement groupé, initiative pré-remplie ----------------
    const carte = (await appel('POST', '/api/maps', { nom: 'Carte des rencontres', grid: { cols: 20, rows: 15 }, force: true }, { mj: true })).donnees.map;
    await appel('POST', `/api/maps/${carte.id}/activate`, {}, { mj: true });
    verifier((await appel('POST', `/api/maps/${carte.id}/rencontres/${rencontre.id}/deployer`, { x: 10, y: 7 })).statut === 403,
      'Déployer : réservé au MJ.');
    r = await appel('POST', `/api/maps/${carte.id}/rencontres/${rencontre.id}/deployer`, { x: 10, y: 7 }, { mj: true });
    verifier(r.statut === 201 && r.donnees.mobs.length === 4 && r.donnees.placees === 4 && r.donnees.initiativeAjoutee === false,
      `Déploiement refusé (${r.statut} ${JSON.stringify(r.donnees)}).`);
    const noms = r.donnees.mobs.map(m => m.nom).sort();
    verifier(JSON.stringify(noms) === JSON.stringify(['Chef gobelin', 'Gobelin', 'Gobelin #2', 'Gobelin #3']), `Noms distincts attendus (${noms}).`);
    const mobs = (await appel('GET', '/api/mobs', undefined, { mj: true })).donnees;
    const instances = mobs.filter(m => r.donnees.mobs.some(d => d.id === m.id));
    verifier(instances.filter(m => m.nom.startsWith('Gobelin')).every(m => m.initiative === 14) && instances.find(m => m.nom === 'Chef gobelin').initiative === 8,
      'Hors combat : l\'initiative de la rencontre est gardée sur chaque créature (pré-remplissage).');
    const maps = JSON.parse(fs.readFileSync(bacDonnees.chemin('maps.json'), 'utf8')).maps;
    const tokens = Object.values(maps[carte.id].tokens).filter(t => r.donnees.mobs.some(d => `mob:${d.id}` === t.id));
    verifier(tokens.length === 4 && new Set(tokens.map(t => `${t.x},${t.y}`)).size === 4, 'Quatre jetons, sur quatre cases différentes.');
    verifier(tokens.every(t => Math.max(Math.abs(t.x - 10), Math.abs(t.y - 7)) <= 1 && t.visibleToPlayers), 'Jetons groupés autour de la case choisie, visibles.');
    console.log('PASS: rencontres — déploiement : créatures nommées, groupées autour de la case, initiative gardée');

    // --- Sous-liste de la rencontre : lien gardé sur chaque créature, vu du MJ seul --------
    const premierDeploiement = instances[0].rencontre?.deploiement;
    verifier(premierDeploiement && instances.every(m => m.rencontre?.id === rencontre.id && m.rencontre.nom === 'Embuscade gobeline'
      && m.rencontre.deploiement === premierDeploiement && m.rencontre.le),
    `Chaque créature garde sa rencontre et son déploiement (${JSON.stringify(instances.map(m => m.rencontre))}).`);
    const lienDe = (entites, id) => entites.find(e => e.id === id)?.rencontre;
    const sceneMj = (await appel('GET', '/api/session/scene', undefined, { mj: true })).donnees;
    verifier(instances.every(m => lienDe(sceneMj.entities.mobs, m.id)?.deploiement === premierDeploiement), 'Tableau blanc (MJ) : rencontre transmise.');
    const carteMj = (await appel('GET', '/api/map/active', undefined, { mj: true })).donnees.map;
    verifier(instances.every(m => carteMj.tokens[`mob:${m.id}`]?.entity?.rencontre?.deploiement === premierDeploiement), 'Carte MJ : rencontre transmise.');
    const sceneTable = (await appel('GET', '/api/session/scene')).donnees;
    const carteTable = (await appel('GET', '/api/map/active')).donnees.map;
    verifier(instances.every(m => sceneTable.entities.mobs.some(e => e.id === m.id))
      && !instances.some(m => lienDe(sceneTable.entities.mobs, m.id))
      && !JSON.stringify(sceneTable).includes('Embuscade gobeline') && !JSON.stringify(carteTable).includes('Embuscade gobeline'),
    'Joueurs et Écran : le nom de la rencontre ne leur est jamais transmis.');
    const modele = (await appel('POST', `/api/mob-templates/from-mob/${encodeURIComponent(instances[0].id)}`, { nom: 'Gobelin vétéran' }, { mj: true })).donnees;
    verifier(modele?.template && modele.template.rencontre === null, `Créature promue en modèle : sans rencontre (${JSON.stringify(modele)}).`);
    console.log('PASS: rencontres — sous-liste : rencontre gardée sur chaque créature, transmise au MJ seulement');

    // --- Déploiement en combat : embuscade cachée, insertion à son rang -------------------
    const joueur = JSON.parse(fs.readFileSync(bacDonnees.chemin('data.json'), 'utf8'))[0];
    await appel('POST', '/api/initiative/demarrer', { entrees: [{ kind: 'player', entityId: joueur.id, nom: joueur.nom, valeur: 10 }] }, { mj: true });
    r = await appel('POST', `/api/maps/${carte.id}/rencontres/${rencontre.id}/deployer`, { x: 3, y: 3, cachees: true }, { mj: true });
    verifier(r.statut === 201 && r.donnees.initiativeAjoutee === true, 'En combat : les créatures doivent rejoindre l\'initiative.');
    const ordre = (await appel('GET', '/api/initiative', undefined, { mj: true })).donnees.entrees;
    verifier(ordre.length === 5 && ordre.slice(0, 3).every(e => e.valeur === 14) && ordre[3].kind === 'player' && ordre[4].valeur === 8,
      `Insertion à leur rang (${ordre.map(e => `${e.nom}:${e.valeur}`).join(', ')}).`);
    verifier(ordre.filter(e => e.kind === 'mob').every(e => e.cache === true), 'Embuscade : cachées aussi dans l\'initiative.');
    const secondes = (await appel('GET', '/api/mobs', undefined, { mj: true })).donnees.filter(m => r.donnees.mobs.some(d => d.id === m.id));
    verifier(secondes.length === 4 && secondes.every(m => m.rencontre?.deploiement && m.rencontre.deploiement !== premierDeploiement)
      && new Set(secondes.map(m => m.rencontre.deploiement)).size === 1,
    'Second déploiement de la même rencontre : un nouveau groupe, distinct du premier.');
    const table = (await appel('GET', '/api/initiative')).donnees.entrees;
    verifier(table.length === 1, 'La table ne voit pas les créatures de l\'embuscade.');
    const carteJoueurs = JSON.parse(fs.readFileSync(bacDonnees.chemin('maps.json'), 'utf8')).maps[carte.id];
    verifier(r.donnees.mobs.every(m => carteJoueurs.tokens[`mob:${m.id}`]?.visibleToPlayers === false), 'Embuscade : jetons cachés sur la carte.');
    const scene = (await appel('GET', `/api/session/scene?role=player&playerId=${encodeURIComponent(joueur.id)}`)).donnees;
    verifier(!r.donnees.mobs.some(m => scene.tokens[`mob:${m.id}`]), 'Embuscade : créatures cachées aussi sur le tableau blanc.');
    console.log('PASS: rencontres — en combat : insertion à leur rang ; embuscade cachée (carte, tableau, initiative)');

    // --- Sous-liste : tout cacher / montrer (carte, tableau blanc) --------------------------
    const visibiliteCarte = (deploiement, corps, options) =>
      appel('PUT', `/api/maps/${carte.id}/rencontres/deploiements/${deploiement}/visibilite`, corps, options);
    const visibiliteTableau = (deploiement, corps, options) =>
      appel('PUT', `/api/session/scene/rencontres/deploiements/${deploiement}/visibilite`, corps, options);
    const jetonsCarte = () => JSON.parse(fs.readFileSync(bacDonnees.chemin('maps.json'), 'utf8')).maps[carte.id].tokens;
    verifier((await visibiliteCarte(premierDeploiement, { visible: false })).statut === 403, 'Cacher une rencontre (carte) : réservé au MJ.');
    verifier((await visibiliteTableau(premierDeploiement, { visible: false })).statut === 403, 'Cacher une rencontre (tableau) : réservé au MJ.');
    verifier((await visibiliteCarte(premierDeploiement, { visible: 'non' }, { mj: true })).statut === 400, 'Visibilité : booléen attendu.');
    verifier((await visibiliteCarte('inconnu', { visible: false }, { mj: true })).statut === 404, 'Déploiement inconnu : 404.');
    r = await visibiliteCarte(premierDeploiement, { visible: false }, { mj: true });
    verifier(r.statut === 200 && r.donnees.tokenIds.length === 4 && instances.every(m => jetonsCarte()[`mob:${m.id}`].visibleToPlayers === false),
      `Carte : les 4 créatures de la rencontre cachées d'un coup (${r.statut} ${JSON.stringify(r.donnees)}).`);
    verifier(secondes.every(m => jetonsCarte()[`mob:${m.id}`].visibleToPlayers === false) && Object.values(jetonsCarte()).some(t => t.visibleToPlayers),
      'Carte : seules les créatures de ce déploiement changent.');
    const carteVueTable = (await appel('GET', '/api/map/active')).donnees.map;
    verifier(!instances.some(m => carteVueTable.tokens[`mob:${m.id}`]), 'Carte : créatures cachées absentes de la vue des joueurs.');
    await visibiliteCarte(premierDeploiement, { visible: true }, { mj: true });
    verifier(instances.every(m => jetonsCarte()[`mob:${m.id}`].visibleToPlayers === true), 'Carte : les créatures sont de nouveau montrées.');
    r = await visibiliteTableau(premierDeploiement, { visible: false }, { mj: true });
    let sceneVue = (await appel('GET', '/api/session/scene')).donnees;
    verifier(r.statut === 200 && !instances.some(m => sceneVue.tokens[`mob:${m.id}`]), 'Tableau blanc : créatures de la rencontre cachées aux joueurs.');
    // Défaut corrigé (V2.4) : « Replacer les pions » ne dévoile plus les pions
    // cachés, et un pion caché peut de nouveau être montré à l'unité.
    verifier((await appel('POST', '/api/session/scene/reset', {}, { mj: true })).statut === 200, 'Replacer les pions refusé.');
    sceneVue = (await appel('GET', '/api/session/scene')).donnees;
    verifier(!instances.some(m => sceneVue.tokens[`mob:${m.id}`]), 'Replacer les pions : les créatures cachées restent cachées.');
    r = await appel('POST', `/api/session/scene/token/${encodeURIComponent(`mob:${instances[0].id}`)}/toggle-visibility`, {}, { mj: true });
    verifier(r.statut === 200 && r.donnees.visibleToPlayers === true, `Montrer un pion caché, à l'unité (${r.statut} ${JSON.stringify(r.donnees)}).`);
    r = await visibiliteTableau(premierDeploiement, { visible: true }, { mj: true });
    sceneVue = (await appel('GET', '/api/session/scene')).donnees;
    verifier(r.statut === 200 && instances.every(m => sceneVue.tokens[`mob:${m.id}`]),
      `Tableau blanc : créatures de nouveau montrées (${r.statut} ${JSON.stringify(r.donnees)} ; ${instances.map(m => !!sceneVue.tokens[`mob:${m.id}`])}).`);
    console.log('PASS: rencontres — sous-liste : tout cacher / montrer (carte, tableau), réservé au MJ');

    // --- Sous-liste : tout retirer de la partie (combat en cours) ---------------------------
    const secondDeploiement = secondes[0].rencontre.deploiement;
    verifier((await appel('DELETE', `/api/rencontres/deploiements/${secondDeploiement}`)).statut === 403, 'Retirer une rencontre : réservé au MJ.');
    verifier((await appel('DELETE', '/api/rencontres/deploiements/inconnu', undefined, { mj: true })).statut === 404, 'Retirer : déploiement inconnu, 404.');
    r = await appel('DELETE', `/api/rencontres/deploiements/${secondDeploiement}`, undefined, { mj: true });
    verifier(r.statut === 200 && r.donnees.nombre === 4, `Retrait refusé (${r.statut} ${JSON.stringify(r.donnees)}).`);
    const restants = (await appel('GET', '/api/mobs', undefined, { mj: true })).donnees;
    verifier(!restants.some(m => secondes.some(s => s.id === m.id)) && instances.every(m => restants.some(x => x.id === m.id)),
      'Seules les créatures de ce déploiement quittent la partie.');
    const ordreApres = (await appel('GET', '/api/initiative', undefined, { mj: true })).donnees.entrees;
    verifier(ordreApres.length === 1 && ordreApres[0].kind === 'player', `Elles quittent aussi l'initiative (${ordreApres.map(e => e.nom)}).`);
    verifier(!secondes.some(m => jetonsCarte()[`mob:${m.id}`]), 'Elles quittent la carte.');
    verifier(JSON.parse(fs.readFileSync(bacDonnees.chemin('rencontres.json'), 'utf8')).some(x => x.id === rencontre.id),
      'La rencontre préparée reste dans Données de jeu.');
    console.log('PASS: rencontres — sous-liste : tout retirer de la partie (carte, tableau, initiative), rencontre gardée');

    // --- Modèle retiré du bestiaire : ligne ignorée -----------------------------------------
    await appel('DELETE', `/api/mob-templates/${chef.id}`, undefined, { mj: true });
    await appel('POST', '/api/initiative/terminer', {}, { mj: true });
    r = await appel('POST', `/api/maps/${carte.id}/rencontres/${rencontre.id}/deployer`, { x: 15, y: 10 }, { mj: true });
    verifier(r.statut === 201 && r.donnees.mobs.length === 3 && r.donnees.ignores.includes(chef.id), 'Modèle retiré : sa ligne est ignorée, le reste est déployé.');
    console.log('PASS: rencontres — modèle retiré du bestiaire ignoré au déploiement');
  } catch (erreur) {
    if (erreurs) console.error(erreurs);
    throw erreur;
  } finally {
    serveur.kill();
  }
}

main().catch(erreur => { console.error(erreur); process.exit(1); });
