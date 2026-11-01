// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
const path = require('path');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Écran enrichi (V2.4) : réglages enregistrés dans la partie — bandeau du
// groupe, cadrage, suivi du combattant actif, créatures mortes masquées.
// ---------------------------------------------------------------------------
function verifier(condition, message) {
  if (!condition) throw new Error(message);
}

// --- Normalisation du cadrage (module pur) ---------------------------------------------
{
  const { normaliserCadrage } = require('../session');
  verifier(normaliserCadrage(null) === null, 'Cadrage absent : carte entière (null).');
  verifier(normaliserCadrage({ x: 'a', y: 0, w: 5, h: 5 }) === null, 'Cadrage non numérique refusé.');
  verifier(normaliserCadrage({ x: 0, y: 0, w: 0, h: 5 }) === null, 'Largeur nulle refusée.');
  verifier(JSON.stringify(normaliserCadrage({ x: -3, y: 2.6, w: '8', h: 9000 })) === JSON.stringify({ x: 0, y: 3, w: 8, h: 500 }),
    'Cadrage : entiers, positifs, taille plafonnée.');
}
console.log('PASS: cadrage de l\'Écran — normalisation');

const PORT = 3400 + Math.floor(Math.random() * 50);
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

    // Valeurs par défaut.
    let r = await appel('GET', '/api/ecran');
    verifier(r.donnees.groupe === true && r.donnees.cadrage === null && r.donnees.suivreActif === false && r.donnees.masquerMorts === true,
      `Réglages par défaut : bandeau affiché, carte entière, sans suivi (${JSON.stringify(r.donnees)}).`);

    // Le MJ règle l'Écran.
    r = await appel('POST', '/api/ecran', { cadrage: { x: 4, y: 2, w: 12, h: 8 }, suivreActif: true, groupe: false }, { mj: true });
    verifier(r.statut === 200, `Réglage refusé (${r.statut}).`);
    r = await appel('GET', '/api/ecran');
    verifier(JSON.stringify(r.donnees.cadrage) === JSON.stringify({ x: 4, y: 2, w: 12, h: 8 }) && r.donnees.suivreActif === true && r.donnees.groupe === false,
      `Réglages enregistrés (${JSON.stringify(r.donnees)}).`);

    // Réservé au MJ, et valeurs contrôlées.
    verifier((await appel('POST', '/api/ecran', { cadrage: null })).statut === 403, 'Cadrage réservé au MJ.');
    verifier((await appel('POST', '/api/ecran', { groupe: 'non' }, { mj: true })).statut === 400, 'Booléen attendu pour le bandeau.');
    verifier((await appel('POST', '/api/ecran', { cadrage: { x: 1 } }, { mj: true })).statut === 400, 'Cadrage incomplet refusé.');

    // Carte entière.
    r = await appel('POST', '/api/ecran', { cadrage: null }, { mj: true });
    verifier(r.donnees.cadrage === null, 'Retour à la carte entière.');

    // Une autre carte devient active : le cadrage repart à zéro.
    await appel('POST', '/api/ecran', { cadrage: { x: 1, y: 1, w: 6, h: 6 } }, { mj: true });
    const nouvelle = (await appel('POST', '/api/maps', { nom: 'Carte du test Écran', grid: { cols: 20, rows: 15 } }, { mj: true })).donnees;
    const idCarte = nouvelle?.map?.id || nouvelle?.id;
    verifier(idCarte, `Carte de test non créée (${JSON.stringify(nouvelle)}).`);
    verifier((await appel('POST', `/api/maps/${encodeURIComponent(idCarte)}/activate`, {}, { mj: true })).statut === 200, 'Activation refusée.');
    r = await appel('GET', '/api/ecran');
    verifier(r.donnees.cadrage === null, 'Nouvelle carte active : cadrage remis sur la carte entière.');
    console.log('PASS: réglages de l\'Écran — enregistrés, réservés au MJ, contrôlés, remis à zéro au changement de carte');
  } catch (erreur) {
    if (erreurs) console.error(erreurs);
    throw erreur;
  } finally {
    serveur.kill();
  }
}

main().catch(erreur => { console.error(erreur); process.exit(1); });
