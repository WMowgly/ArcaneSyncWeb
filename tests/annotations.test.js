// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
// tests/annotations.test.js
// ---------------------------------------------------------------------------
// V1.13.2 — Le tableau blanc fusionné avec la carte.
//
// Vérifie que les annotations sont persistées, attribuées à un auteur,
// soumises aux droits MJ/joueur, et surtout DÉCOUPÉES par le brouillard :
// un tracé qui traverse une zone inexplorée ne doit jamais parvenir au
// joueur, même partiellement.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const mapsFile = bacDonnees.chemin('maps.json');
const originalMaps = fs.existsSync(mapsFile) ? fs.readFileSync(mapsFile, 'utf8') : null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  delete require.cache[require.resolve('../map')];
  const mapStore = require('../map');
  mapStore.activerBrouillard(true); // désactivé dans l'appli, toujours testé

  const JOUEUR = 'char_annot_a';
  const AUTRE = 'char_annot_b';

  const entities = {
    players: [
      { id: JOUEUR, nom: 'Alix', hp: { current: 10, max: 10 }, statuts: [] },
      { id: AUTRE, nom: 'Bram', hp: { current: 10, max: 10 }, statuts: [] }
    ],
    mobs: []
  };

  const creation = mapStore.createMap({
    nom: '__TEST_ANNOT__',
    grid: { cols: 20, rows: 10, cellSize: 40 }
  });
  assert(creation.success, 'Création de carte impossible.');
  const mapId = creation.map.id;

  // ---------------------------------------------------------------------
  // 1. Modèle et validation
  // ---------------------------------------------------------------------
  assert(creation.map.drawing.playersAllowed === false,
    'Les joueurs ne doivent pas pouvoir annoter par défaut.');
  assert(typeof creation.map.annotations === 'object',
    'Une carte doit posséder un espace annotations.');

  const traitMj = mapStore.ajouterAnnotation(mapId, {
    type: 'trait',
    points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }],
    color: '#123456',
    size: 5
  }, { role: 'mj' });

  assert(traitMj.success, 'Le MJ doit pouvoir tracer.');
  assert(traitMj.map.annotations[traitMj.annotationId].author === 'mj', 'Auteur MJ non enregistré.');
  assert(traitMj.map.annotations[traitMj.annotationId].color === '#123456', 'Couleur non conservée.');

  const traitCourt = mapStore.ajouterAnnotation(mapId,
    { type: 'trait', points: [{ x: 1, y: 1 }] }, { role: 'mj' });
  assert(!traitCourt.success, 'Un tracé d\'un seul point doit être refusé.');

  const texteVide = mapStore.ajouterAnnotation(mapId,
    { type: 'texte', text: '   ', points: [{ x: 1, y: 1 }] }, { role: 'mj' });
  assert(!texteVide.success, 'Un texte vide doit être refusé.');

  // Coordonnées fractionnaires : c'est ce qui rend l'annotation
  // indépendante de la taille de case, contrairement au tableau V1.10.
  const fractionnaire = mapStore.ajouterAnnotation(mapId, {
    type: 'trait',
    points: [{ x: 1.25, y: 2.75 }, { x: 4.5, y: 2.75 }]
  }, { role: 'mj' });
  assert(fractionnaire.map.annotations[fractionnaire.annotationId].points[0].x === 1.25,
    'Les coordonnées fractionnaires doivent être conservées.');

  // ---------------------------------------------------------------------
  // 2. Droits des joueurs
  // ---------------------------------------------------------------------
  const refuse = mapStore.ajouterAnnotation(mapId,
    { type: 'trait', points: [{ x: 1, y: 3 }, { x: 2, y: 3 }] },
    { role: 'player', playerId: JOUEUR });
  assert(!refuse.success, 'Un joueur ne doit pas pouvoir annoter sans autorisation du MJ.');

  assert(mapStore.setDrawingConfig(mapId, { playersAllowed: true }).success,
    'Activation du dessin joueur impossible.');

  const traitJoueur = mapStore.ajouterAnnotation(mapId, {
    type: 'trait',
    points: [{ x: 1, y: 3 }, { x: 2, y: 3 }],
    // Tentative de créer un calque secret : doit être ignorée.
    visibleToPlayers: false,
    author: 'mj'
  }, { role: 'player', playerId: JOUEUR });

  assert(traitJoueur.success, 'Un joueur autorisé doit pouvoir annoter.');
  const enregistre = traitJoueur.map.annotations[traitJoueur.annotationId];
  assert(enregistre.author === JOUEUR, "L'auteur doit être le joueur, pas la valeur qu'il envoie.");
  assert(enregistre.visibleToPlayers === true,
    'Un joueur ne doit pas pouvoir créer une annotation cachée aux autres joueurs.');

  // ---------------------------------------------------------------------
  // 3. Suppression
  // ---------------------------------------------------------------------
  const suppressionInterdite = mapStore.supprimerAnnotation(mapId, traitMj.annotationId,
    { role: 'player', playerId: JOUEUR });
  assert(!suppressionInterdite.success, "Un joueur ne doit pas pouvoir effacer le tracé du MJ.");

  const suppressionAutrui = mapStore.supprimerAnnotation(mapId, traitJoueur.annotationId,
    { role: 'player', playerId: AUTRE });
  assert(!suppressionAutrui.success, "Un joueur ne doit pas pouvoir effacer le tracé d'un autre joueur.");

  const suppressionSienne = mapStore.supprimerAnnotation(mapId, traitJoueur.annotationId,
    { role: 'player', playerId: JOUEUR });
  assert(suppressionSienne.success, 'Un joueur doit pouvoir effacer son propre tracé.');

  // ---------------------------------------------------------------------
  // 4. Découpage par le brouillard de guerre
  // ---------------------------------------------------------------------
  mapStore.placerToken(mapId, { kind: 'player', entityId: JOUEUR, x: 2, y: 5, vision: { range: 4 } });
  mapStore.placerToken(mapId, { kind: 'player', entityId: AUTRE, x: 18, y: 5 });
  mapStore.setFogConfig(mapId, { enabled: true, mode: 'vision', autoReveal: true });

  const SECRET = '__TEXTE_CACHE__';

  // Un long tracé qui part de la zone visible et s'enfonce dans l'inconnu.
  const points = [];
  for (let x = 1; x <= 18; x += 1) points.push({ x, y: 5 });
  const traversant = mapStore.ajouterAnnotation(mapId,
    { type: 'trait', points, color: '#aa0000' }, { role: 'mj' });
  assert(traversant.success, 'Tracé traversant non enregistré.');

  // Un texte posé loin, hors de portée du personnage.
  const texteLoin = mapStore.ajouterAnnotation(mapId,
    { type: 'texte', text: SECRET, points: [{ x: 16, y: 5 }] }, { role: 'mj' });
  assert(texteLoin.success, 'Texte éloigné non enregistré.');

  // Un tracé du calque MJ, dans la zone pourtant visible.
  const calqueMj = mapStore.ajouterAnnotation(mapId, {
    type: 'trait',
    points: [{ x: 1, y: 5 }, { x: 2, y: 5 }],
    visibleToPlayers: false,
    text: ''
  }, { role: 'mj' });
  assert(calqueMj.success, 'Tracé du calque MJ non enregistré.');

  const vueJoueur = mapStore.getMapForViewer(mapId, { role: 'player', playerId: JOUEUR, entities });
  const vueMj = mapStore.getMapForViewer(mapId, { role: 'mj', entities });
  const brut = JSON.stringify(vueJoueur);

  assert(vueMj.annotations[calqueMj.annotationId], 'Le MJ doit voir son calque privé.');
  assert(!brut.includes(SECRET), 'Un texte hors du champ de vision a fuité.');
  assert(!brut.includes('visibleToPlayers'),
    'Le champ visibleToPlayers ne doit pas être transmis au joueur.');

  const fragments = Object.values(vueJoueur.annotations)
    .filter(a => String(a.id).startsWith(traversant.annotationId));
  assert(fragments.length > 0, 'La partie visible du tracé doit être transmise.');

  const xMax = Math.max(...fragments.flatMap(f => f.points.map(p => p.x)));
  assert(xMax <= 7, `Le tracé doit être coupé au bord du champ de vision (xMax reçu : ${xMax}).`);

  const tracesMjPrivees = Object.values(vueJoueur.annotations)
    .filter(a => String(a.id).startsWith(calqueMj.annotationId));
  assert(tracesMjPrivees.length === 0, 'Le calque MJ ne doit jamais être transmis au joueur.');

  // Un joueur voit toujours ses propres tracés en entier.
  // Position choisie hors de portée des DEUX personnages :
  // Alix est en (2,5) portée 4, Bram en (18,5) portée 6.
  mapStore.setDrawingConfig(mapId, { playersAllowed: true });
  const sienLoin = mapStore.ajouterAnnotation(mapId,
    { type: 'trait', points: [{ x: 9, y: 1 }, { x: 10, y: 1 }] },
    { role: 'player', playerId: JOUEUR });
  const vueApres = mapStore.getMapForViewer(mapId, { role: 'player', playerId: JOUEUR, entities });
  assert(vueApres.annotations[sienLoin.annotationId],
    'Un joueur doit toujours voir ses propres annotations.');
  assert(vueApres.annotations[sienLoin.annotationId].own === true,
    'Ses propres annotations doivent être marquées `own`.');
  assert(vueApres.annotations[sienLoin.annotationId].authorName === 'Alix',
    "Le nom de l'auteur doit être résolu.");

  // L'autre joueur, lui, ne le voit pas : il est loin et n'a rien exploré.
  const vueAutre = mapStore.getMapForViewer(mapId, { role: 'player', playerId: AUTRE, entities });
  const vuParAutre = Object.values(vueAutre.annotations)
    .filter(a => String(a.id).startsWith(sienLoin.annotationId));
  assert(vuParAutre.length === 0, "Un tracé hors du champ de vision d'un autre joueur ne doit pas lui parvenir.");

  // ---------------------------------------------------------------------
  // 5. Aperçu en direct : même filtrage
  // ---------------------------------------------------------------------
  assert(mapStore.segmentAutorisePour(mapId, JOUEUR, [{ x: 2, y: 5 }, { x: 3, y: 5 }]) === true,
    'Un segment dans le champ de vision doit être relayé.');
  assert(mapStore.segmentAutorisePour(mapId, JOUEUR, [{ x: 15, y: 5 }, { x: 16, y: 5 }]) === false,
    "Un segment hors du champ de vision ne doit jamais être relayé en direct.");
  assert(mapStore.segmentAutorisePour(mapId, JOUEUR, [{ x: 3, y: 5 }, { x: 16, y: 5 }]) === false,
    'Un segment dont une extrémité est cachée ne doit pas être relayé.');

  // Sans brouillard, tout est relayé.
  mapStore.setFogConfig(mapId, { enabled: false, mode: 'none' });
  assert(mapStore.segmentAutorisePour(mapId, JOUEUR, [{ x: 15, y: 5 }, { x: 16, y: 5 }]) === true,
    'Sans brouillard, un segment doit toujours être relayé.');
  mapStore.setFogConfig(mapId, { enabled: true, mode: 'vision', autoReveal: true });

  // ---------------------------------------------------------------------
  // 6. Suppression via un identifiant de fragment
  // ---------------------------------------------------------------------
  const fragmentId = fragments[0].id;
  assert(fragmentId.includes('~'), 'Un fragment doit porter un identifiant dérivé.');
  assert(mapStore.supprimerAnnotation(mapId, fragmentId, { role: 'mj' }).success,
    "Effacer un fragment doit effacer l'annotation d'origine.");
  assert(!mapStore.getMapById(mapId).annotations[traversant.annotationId],
    "L'annotation d'origine doit avoir disparu.");

  // ---------------------------------------------------------------------
  // 7. Effacement en masse
  // ---------------------------------------------------------------------
  mapStore.ajouterAnnotation(mapId, { type: 'trait', points: [{ x: 1, y: 7 }, { x: 2, y: 7 }] }, { role: 'mj' });
  mapStore.ajouterAnnotation(mapId, { type: 'trait', points: [{ x: 1, y: 8 }, { x: 2, y: 8 }] },
    { role: 'player', playerId: JOUEUR });

  const avantVidage = Object.keys(mapStore.getMapById(mapId).annotations).length;
  assert(avantVidage >= 2, 'Annotations de test manquantes.');

  const videJoueurs = mapStore.viderAnnotations(mapId, 'players', { role: 'mj' });
  assert(videJoueurs.success, 'Effacement ciblé impossible.');
  const restantes = Object.values(mapStore.getMapById(mapId).annotations);
  assert(restantes.every(a => a.author === 'mj'),
    "L'effacement « joueurs » ne doit laisser que les annotations du MJ.");

  // Un joueur qui vide n'efface que les siennes, quel que soit le périmètre demandé.
  mapStore.ajouterAnnotation(mapId, { type: 'trait', points: [{ x: 3, y: 9 }, { x: 4, y: 9 }] },
    { role: 'player', playerId: JOUEUR });
  const avantJoueur = Object.values(mapStore.getMapById(mapId).annotations).filter(a => a.author === 'mj').length;
  mapStore.viderAnnotations(mapId, 'all', { role: 'player', playerId: JOUEUR });
  const apresJoueur = Object.values(mapStore.getMapById(mapId).annotations);
  assert(apresJoueur.filter(a => a.author === 'mj').length === avantJoueur,
    "Un joueur ne doit pas pouvoir effacer les annotations du MJ.");
  assert(apresJoueur.every(a => a.author !== JOUEUR), 'Ses propres annotations doivent être effacées.');

  // ---------------------------------------------------------------------
  // 8. Persistance et redimensionnement
  // ---------------------------------------------------------------------
  const survivant = mapStore.ajouterAnnotation(mapId,
    { type: 'texte', text: 'Piège ici', points: [{ x: 18.5, y: 9.5 }], size: 4 }, { role: 'mj' });

  // V1.13.5 : la pose d'annotation emprunte le chemin d'écriture différée.
  // Toute relecture DISQUE doit donc être précédée d'un vidage explicite —
  // c'est aussi la garantie que flush() fonctionne réellement.
  assert(mapStore.flush(), 'Le vidage des écritures en attente a échoué.');

  delete require.cache[require.resolve('../map')];
  const recharge = require('../map');
  recharge.activerBrouillard(true); // désactivé dans l'appli, toujours testé
  const apresRechargement = recharge.getMapById(mapId);
  assert(apresRechargement.annotations[survivant.annotationId],
    'Une annotation doit survivre au rechargement du module (persistance).');
  assert(apresRechargement.drawing.playersAllowed === true,
    "L'autorisation de dessin doit être persistée.");

  assert(recharge.updateMap(mapId, { grid: { cols: 10, rows: 6 } }).success,
    'Redimensionnement impossible.');
  const reduite = recharge.getMapById(mapId);
  const pointReduit = reduite.annotations[survivant.annotationId].points[0];
  assert(pointReduit.x <= 10 && pointReduit.y <= 6,
    'Les annotations doivent être ramenées dans la nouvelle grille.');

  recharge.deleteMap(mapId);

  // ---------------------------------------------------------------------
  // 9. Câblage serveur et interfaces
  // ---------------------------------------------------------------------
  const serverSource = require('./_sources').sourceServeur();
  assert(serverSource.includes("app.post('/api/maps/:mapId/annotations'"), 'Route de création absente.');
  assert(serverSource.includes("app.delete('/api/maps/:mapId/annotations/:annotationId'"), 'Route de suppression absente.');
  assert(serverSource.includes("app.delete('/api/maps/:mapId/annotations'"), 'Route d\'effacement en masse absente.');
  assert(serverSource.includes("app.put('/api/maps/:mapId/drawing'"), 'Route d\'autorisation absente.');
  assert(serverSource.includes("socket.on('mapDrawStream'"), 'Relais temps réel du tracé absent.');
  assert(serverSource.includes('segmentAutorisePour'), 'Le relais temps réel doit filtrer par brouillard.');

  const mjSource = fs.readFileSync(path.join(__dirname, '..', 'website', 'map.html'), 'utf8');
  const coreSource = fs.readFileSync(path.join(__dirname, '..', 'website', 'map-core.js'), 'utf8');

  assert(mjSource.includes('data-tool="dessin"'), 'Outil de dessin absent de l\'interface MJ.');
  assert(mjSource.includes('data-tool="texte"'), 'Outil d\'écriture absent de l\'interface MJ.');
  assert(mjSource.includes('annot-layer'), 'Sélecteur de calque absent de l\'interface MJ.');
  assert(mjSource.includes('annot-players'), 'Autorisation des joueurs absente de l\'interface MJ.');
  // La carte joueur (map_joueur.html) a été retirée : l'Écran affiche les
  // annotations en direct.
  assert(!fs.existsSync(path.join(__dirname, '..', 'website', 'map_joueur.html')), 'La carte joueur doit avoir été retirée.');
  assert(fs.readFileSync(path.join(__dirname, '..', 'website', 'ecran.html'), 'utf8').includes("socket.on('mapDrawPreview'"),
    'Aperçu temps réel des annotations absent de l\'Écran.');
  assert(coreSource.includes('dessinerAnnotations'), 'Rendu des annotations absent du moteur partagé.');
  assert(coreSource.includes('pointFromEvent'), 'Coordonnées fractionnaires absentes du moteur partagé.');

  // Le tableau blanc historique reste intact.
  const tableauSource = fs.readFileSync(path.join(__dirname, '..', 'website', 'tableau.html'), 'utf8');
  assert(tableauSource.includes("socket.emit('draw'"), 'Le tableau blanc V1.10 doit rester fonctionnel.');
  assert(serverSource.includes("socket.on('draw'"), 'Le relais du tableau blanc V1.10 doit être conservé.');

  console.log('PASS: V1.13.2 annotations de carte — persistance, calques, découpage par le brouillard');
} finally {
  // V1.13.5 : ce test restaure ses fichiers lui-même, hors du dépôt.
  // Sans cet abandon, le vidage à l'arrêt du processus réécrirait
  // l'état de test par-dessus la restauration.
  require('../storage').annulerTout();

  if (originalMaps === null) {
    try { fs.unlinkSync(mapsFile); } catch (_) {}
  } else {
    fs.writeFileSync(mapsFile, originalMaps, 'utf8');
  }
  delete require.cache[require.resolve('../map')];
}
