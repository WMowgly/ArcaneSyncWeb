// Bac a sable de donnees : DOIT rester le tout premier require.
require('./_donnees');
const fs = require('fs');
const path = require('path');

function verifier(condition, message) {
  if (!condition) throw new Error(message);
}

const mapStore = require('../map');
const crees = [];
const creer = donnees => {
  const r = mapStore.createMap({ nom: `__TEST_QUADRILLAGE_${crees.length}__`, ...donnees }, { force: true });
  verifier(r.success, `Création de carte impossible : ${r.message}`);
  crees.push(r.map.id);
  return r.map;
};

try {
  // ---------------------------------------------------------------------
  // 1. Quadrillage par défaut : deux fois plus de cases (résolution 2)
  // ---------------------------------------------------------------------
  const neuve = creer({});
  verifier(neuve.grid.cols === 48 && neuve.grid.rows === 32 && neuve.grid.resolution === 2 && neuve.grid.cellSize === 24,
    `Quadrillage par défaut inattendu : ${JSON.stringify(neuve.grid)}`);
  const ancienne = creer({ grid: { cols: 24, rows: 16, cellSize: 48 } });
  verifier(ancienne.grid.resolution === 1, 'Une carte aux dimensions explicites (antérieure) reste en résolution 1.');

  // ---------------------------------------------------------------------
  // 2. Conversion de résolution : le contenu reste en place
  // ---------------------------------------------------------------------
  const id = ancienne.id;
  const el = mapStore.ajouterElement(id, { kind: 'couleur', color: '#3c6ea3', x: 3, y: 4 });
  verifier(el.success, 'Pose d’une case de couleur impossible.');
  const caseCouleur = mapStore.getMapById(id).elements[el.elementId];
  verifier(caseCouleur.kind === 'couleur' && caseCouleur.icone === '' && caseCouleur.color === '#3c6ea3'
    && !caseCouleur.blocksMovement && !caseCouleur.blocksVision,
    `Case de couleur mal normalisée : ${JSON.stringify(caseCouleur)}`);

  mapStore.placerToken(id, { kind: 'player', entityId: 'char_quad', x: 5, y: 5 });
  const note = mapStore.ajouterAnnotation(id, { type: 'trait', points: [{ x: 2.5, y: 3 }, { x: 4, y: 3 }] }, { role: 'mj' });
  verifier(note.success, 'Annotation impossible.');

  const x2 = mapStore.changerResolution(id, 2);
  verifier(x2.success && x2.cols === 48 && x2.rows === 32, `Passage à ×2 refusé : ${x2.message}`);
  let carte = mapStore.getMapById(id);
  verifier(carte.grid.resolution === 2 && carte.grid.cellSize === 24, 'Grille ×2 : résolution et taille de case.');
  const e2 = carte.elements[el.elementId];
  verifier(e2.x === 6 && e2.y === 8 && e2.w === 2 && e2.h === 2, `Case convertie : ${JSON.stringify(e2)}`);
  const t2 = carte.tokens['player:char_quad'];
  verifier(t2.x === 10 && t2.y === 10 && t2.size === 1,
    `Jeton converti (position suivie, taille gardée à 1 case) : ${JSON.stringify(t2)}`);
  const p2 = carte.annotations[note.annotationId].points[0];
  verifier(p2.x === 5 && p2.y === 6, `Tracé converti : ${JSON.stringify(p2)}`);
  verifier(!mapStore.changerResolution(id, 2).success, 'Même résolution : rien à faire.');

  // Un jeton neuf occupe une seule case, même en ×2 (pions plus petits).
  mapStore.placerToken(id, { kind: 'mob', entityId: 'mob_quad', x: 1, y: 1 });
  verifier(mapStore.getMapById(id).tokens['mob:mob_quad'].size === 1, 'Un jeton neuf doit occuper une case.');
  // Une taille choisie dans l'inspecteur est conservée par la conversion.
  mapStore.updateToken(id, 'mob:mob_quad', { size: 3 });

  // Retour à ×1 : les cases fines identiques se regroupent en une seule.
  mapStore.ajouterElements(id, [
    { kind: 'couleur', color: '#b8342a', x: 20, y: 20 },
    { kind: 'couleur', color: '#b8342a', x: 21, y: 21 }
  ]);
  const x1 = mapStore.changerResolution(id, 1);
  verifier(x1.success && x1.cols === 24 && x1.rows === 16, 'Retour à ×1 refusé.');
  carte = mapStore.getMapById(id);
  const rouges = Object.values(carte.elements).filter(e => e.color === '#b8342a');
  verifier(rouges.length === 1 && rouges[0].x === 10 && rouges[0].y === 10, `Regroupement : ${JSON.stringify(rouges)}`);
  verifier(carte.elements[el.elementId].x === 3 && carte.tokens['player:char_quad'].x === 5
    && carte.tokens['player:char_quad'].size === 1, 'Aller-retour ×1 → ×2 → ×1 : retour exact du contenu.');
  verifier(carte.tokens['mob:mob_quad'].size === 3, "La taille d'un jeton réglée par le MJ est conservée.");

  // Limites.
  verifier(!mapStore.changerResolution(id, 5).success && !mapStore.changerResolution(id, 'x').success,
    'Résolution hors 1..4 refusée.');
  const grande = creer({ grid: { cols: 80, rows: 60 } });
  verifier(!mapStore.changerResolution(grande.id, 4).success, '320 colonnes dépassent le maximum : refus attendu.');

  // ---------------------------------------------------------------------
  // 3. Brouillard désactivé dans l'application
  // ---------------------------------------------------------------------
  const brumeuse = creer({ fog: { enabled: true, mode: 'vision' } });
  mapStore.placerToken(brumeuse.id, { kind: 'player', entityId: 'char_a', x: 1, y: 1 });
  mapStore.placerToken(brumeuse.id, { kind: 'mob', entityId: 'mob_loin', x: 40, y: 30 });
  const entities = { players: [{ id: 'char_a', nom: 'A' }], mobs: [{ id: 'mob_loin', nom: 'Loin' }] };
  const vue = mapStore.getMapForViewer(brumeuse.id, { role: 'player', playerId: 'char_a', entities });
  verifier(vue.fog.enabled === false && vue.vision.visible === null, 'Le brouillard ne doit plus s’appliquer.');
  verifier(vue.tokens['mob:mob_loin'], 'Sans brouillard, une créature lointaine visible est transmise.');
  verifier(mapStore.getMapById(brumeuse.id).fog.enabled === true, 'Le réglage enregistré est conservé (ignoré).');

  // ---------------------------------------------------------------------
  // 4. Câblage serveur et interface
  // ---------------------------------------------------------------------
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const route = serverSource.match(/app\.post\('\/api\/maps\/:mapId\/resolution'[^]*?\n\}\);/);
  verifier(route && route[0].includes('refuserSiPasMj'), 'La route de résolution doit être réservée au MJ.');
  verifier(serverSource.includes("modele = { ...modele, color: req.body.color }"), 'La pose par lot doit accepter une couleur.');

  const mj = fs.readFileSync(path.join(__dirname, '..', 'website', 'map.html'), 'utf8');
  verifier(mj.includes('id="opt-resolution"'), 'Sélecteur de quadrillage absent.');
  verifier(!mj.includes('btn-portes-ouvrir') && !mj.includes('btn-portes-fermer'), 'Boutons Ouvrir/Fermer encore présents.');
  verifier(!mj.includes('id="fog-enabled"') && !mj.includes('fog-hide'), 'Options de brouillard encore présentes.');
  verifier((mj.match(/id="decor-nuancier"[^]*?<\/div>/)[0].match(/data-couleur=/g) || []).length === 16,
    'Le pinceau de décor doit proposer 16 couleurs.');

  console.log('PASS: quadrillage — résolution ×1..×4, conversion fidèle, cases de couleur, brouillard désactivé');
} finally {
  crees.forEach(idCarte => mapStore.deleteMap(idCarte));
  mapStore.flush();
}
