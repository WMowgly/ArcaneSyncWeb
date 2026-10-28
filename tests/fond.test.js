// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Image de fond des cartes : dépôt (MJ), lecture, opacité, duplication,
// retrait, suppression avec la carte. Serveur réel, données du bac à sable.
// ---------------------------------------------------------------------------
const PORT = 3240 + Math.floor(Math.random() * 50);
const BASE = `http://127.0.0.1:${PORT}`;
const MJ = { 'X-ArcaneSync-Role': 'mj', 'X-ArcaneSync-MJ': 'licorne' };
// PNG de 1 × 1 pixel.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function verifier(condition, message) {
  if (!condition) throw new Error(message);
}

async function appel(methode, route, { json, corps, entetes = {} } = {}) {
  const options = { method: methode, headers: { ...entetes } };
  if (json !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(json);
  } else if (corps !== undefined) {
    options.body = corps;
  }
  const reponse = await fetch(`${BASE}${route}`, options);
  const type = reponse.headers.get('Content-Type') || '';
  return {
    statut: reponse.status,
    type,
    donnees: type.includes('json') ? await reponse.json() : Buffer.from(await reponse.arrayBuffer())
  };
}

async function main() {
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

    const creation = await appel('POST', '/api/maps', { json: { nom: 'Carte au fond', force: true }, entetes: MJ });
    verifier(creation.statut === 201, `Création de carte refusée (${creation.statut}).`);
    const mapId = creation.donnees.map.id;
    verifier(creation.donnees.map.background.image === null, 'Une nouvelle carte n\'a pas d\'image de fond.');

    // Dépôt : réservé au MJ, types d'image seulement.
    let r = await appel('PUT', `/api/maps/${mapId}/fond`, { corps: PNG, entetes: { 'Content-Type': 'image/png' } });
    verifier(r.statut === 403, 'Déposer une image sans code MJ doit être refusé.');
    r = await appel('PUT', `/api/maps/${mapId}/fond`, { corps: Buffer.from('<svg/>'), entetes: { ...MJ, 'Content-Type': 'image/svg+xml' } });
    verifier(r.statut === 400, 'Un SVG doit être refusé.');
    r = await appel('PUT', `/api/maps/${mapId}/fond`, { corps: PNG, entetes: { ...MJ, 'Content-Type': 'image/png' } });
    verifier(r.statut === 200, `Dépôt refusé : ${JSON.stringify(r.donnees)}`);
    const adresse = r.donnees.map.background.image;
    verifier(/^\/api\/maps\/[\w-]+\/fond\?v=\d+$/.test(adresse), `Adresse d'image inattendue : ${adresse}`);
    verifier(fs.existsSync(bacDonnees.chemin('cartes_fonds', `${mapId}.png`)), 'Le fichier doit être rangé dans cartes_fonds/.');

    // Lecture libre (l'Écran l'affiche).
    r = await appel('GET', adresse);
    verifier(r.statut === 200 && r.type.startsWith('image/png') && Buffer.compare(r.donnees, PNG) === 0, 'Image servie incorrecte.');

    // Opacité bornée ; une URL externe est ignorée ; la couleur ne retire pas l'image.
    r = await appel('PUT', `/api/maps/${mapId}`, { json: { background: { imageOpacite: 0.02, image: 'https://exemple.org/x.png' } }, entetes: MJ });
    verifier(r.donnees.map.background.imageOpacite === 0.1, 'L\'opacité doit être bornée à 10 %.');
    verifier(r.donnees.map.background.image === adresse, 'Une URL externe ne doit jamais remplacer l\'image.');
    r = await appel('PUT', `/api/maps/${mapId}`, { json: { background: { color: '#112233' } }, entetes: MJ });
    verifier(r.donnees.map.background.image === adresse && r.donnees.map.background.color === '#112233',
      'Changer la couleur doit garder l\'image.');

    // Duplication : la copie a sa propre image.
    r = await appel('POST', `/api/maps/${mapId}/duplicate`, { json: {}, entetes: MJ });
    const copie = r.donnees.map;
    verifier(copie.background.image && copie.background.image.startsWith(`/api/maps/${copie.id}/fond`),
      'La copie doit pointer vers sa propre image.');
    verifier(fs.existsSync(bacDonnees.chemin('cartes_fonds', `${copie.id}.png`)), 'L\'image de la copie doit exister.');

    // Retrait de l'image, puis suppression de la copie avec son fichier.
    r = await appel('DELETE', `/api/maps/${mapId}/fond`, { json: {}, entetes: MJ });
    verifier(r.statut === 200 && r.donnees.map.background.image === null, 'Retrait de l\'image incorrect.');
    verifier(!fs.existsSync(bacDonnees.chemin('cartes_fonds', `${mapId}.png`)), 'Le fichier retiré doit disparaître.');
    verifier((await appel('GET', `/api/maps/${mapId}/fond`)).statut === 404, 'Une image retirée ne doit plus être servie.');
    r = await appel('DELETE', `/api/maps/${copie.id}`, { json: {}, entetes: MJ });
    verifier(r.statut === 200 && !fs.existsSync(bacDonnees.chemin('cartes_fonds', `${copie.id}.png`)),
      'Supprimer une carte doit supprimer son image.');
    await appel('DELETE', `/api/maps/${mapId}`, { json: {}, entetes: MJ });

    // Page MJ et moteur de rendu.
    const page = fs.readFileSync(path.join(__dirname, '..', 'website', 'map.html'), 'utf8');
    verifier(page.includes('id="map-fond-image"') && page.includes('id="map-fond-opacite"') && page.includes('id="btn-fond-retirer"'),
      'Commandes de l\'image de fond absentes de la carte MJ.');
    const coeur = fs.readFileSync(path.join(__dirname, '..', 'website', 'map-core.js'), 'utf8');
    verifier(coeur.includes('ctx.drawImage(image, GUTTER, GUTTER'), 'Le moteur de rendu doit dessiner l\'image sous la grille.');

    console.log('PASS: image de fond — dépôt MJ, lecture, opacité, URL externe refusée, duplication, retrait, suppression');
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
