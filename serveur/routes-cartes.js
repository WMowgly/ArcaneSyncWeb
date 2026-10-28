// serveur/routes-cartes.js
// ---------------------------------------------------------------------------
// Cartes : bibliothèque, carte active, tokens, décor, annotations, brouillard.
//
// Routes déplacées telles quelles depuis server.js (V1.16). Le routeur est
// nommé `app` pour que chaque route garde exactement son écriture d'origine.
// ---------------------------------------------------------------------------
const express = require('express');
const mapStore = require('../map');
const mapGen = require('../mapgen');
const {
  getJoueurById
} = require('../joueur');
const {
  getSessionMobs,
  sauvegarderMobSession,
  getActiveMapId,
  setActiveMapId
} = require('../session');
const {
  createMobFromTemplate,
  normaliserMob,
  nommerInstance
} = require('../mob');
const { roleDepuisRequete, playerIdDepuisRequete, refuserSiPasMj } = require('./acces');
const { getActiveMapForViewer, emitMapState } = require('./diffusion-carte');

const app = express.Router();
let io = null;

// ------------------------------------------------------------------
// V1.13 — SYSTÈME DE CARTES (MAPS)
//
// Principes :
//  1. La carte est une donnée de partie : le serveur est autoritaire.
//  2. Le client ne reçoit JAMAIS la carte brute, seulement une projection
//     construite pour son rôle (map.getMapForViewer).
//  3. Toute mutation MJ passe par REST ; seul le déplacement de token
//     (haute fréquence) passe par Socket.IO.
//  4. Après chaque mutation, le serveur pousse à chaque socket connecté
//     SA propre projection : aucune donnée MJ ne transite vers un joueur.
// ------------------------------------------------------------------

// --- Bibliothèque de cartes ---------------------------------------

// V1.13.5 — La route GET /api/map/element-kinds a été retirée : plus aucun
// appelant depuis le passage aux palettes par biome (V1.13.4), qui exposent
// des pinceaux concrets via GET /api/map/palette. KINDS_ELEMENT reste dans
// map.js, où normaliserElement() s'en sert toujours.

app.get('/api/maps', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  res.json({ maps: mapStore.getMaps(), activeMapId: getActiveMapId() });
});

app.post('/api/maps', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.createMap(req.body || {});
  if (!result.success) {
    // 409 : la carte n'a pas été créée parce qu'une identique existe déjà.
    return res.status(result.duplicate ? 409 : 500)
      .json({ message: result.message, existingMapId: result.existingMapId });
  }

  // Une première carte devient automatiquement la carte active.
  if (!getActiveMapId()) setActiveMapId(result.map.id);

  io.emit('mapLibraryUpdated');
  emitMapState();
  res.status(201).json({ message: 'Carte créée.', map: result.map });
});

app.put('/api/maps/:mapId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.updateMap(req.params.mapId, req.body || {});
  if (!result.success) {
    return res.status(result.message === 'Carte introuvable.' ? 404 : 500)
      .json({ message: result.message });
  }

  io.emit('mapLibraryUpdated');
  emitMapState();
  res.json({ message: 'Carte modifiée.', map: result.map });
});

/** Résolution du quadrillage (1 à 4) : convertit la carte, voir map.js. */
app.post('/api/maps/:mapId/resolution', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.changerResolution(req.params.mapId, req.body?.resolution);
  if (!result.success) {
    if (result.unchanged) return res.json({ message: result.message });
    return res.status(result.message === 'Carte introuvable.' ? 404 : 400).json({ message: result.message });
  }

  io.emit('mapLibraryUpdated');
  emitMapState();
  res.json({
    message: `Quadrillage ×${result.resolution} : ${result.cols}×${result.rows} cases.`,
    resolution: result.resolution
  });
});

app.delete('/api/maps/:mapId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.deleteMap(req.params.mapId);
  if (!result.success) return res.status(404).json({ message: result.message });

  if (getActiveMapId() === req.params.mapId) setActiveMapId(null);

  io.emit('mapLibraryUpdated');
  emitMapState();
  res.json({ message: 'Carte supprimée.' });
});

app.post('/api/maps/:mapId/duplicate', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.duplicateMap(req.params.mapId, req.body?.nom);
  if (!result.success) return res.status(404).json({ message: result.message });

  io.emit('mapLibraryUpdated');
  res.status(201).json({ message: 'Carte dupliquée.', map: result.map });
});

// ------------------------------------------------------------------
// V1.13.10 — L'œil du joueur.
//
// Le MJ demande la projection d'un personnage : EXACTEMENT celle que ce
// joueur reçoit, construite par le même chemin. On ne recalcule rien et
// surtout on ne « simule » rien : simuler laisserait passer un écart
// entre ce que le MJ croit montrer et ce que le joueur voit vraiment.
//
// Route de LECTURE : aucune écriture, aucune diffusion.
// ------------------------------------------------------------------
app.get('/api/map/vue-joueur/:playerId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const playerId = req.params.playerId;
  if (!getJoueurById(playerId)) {
    return res.status(404).json({ message: 'Personnage introuvable.' });
  }

  const projection = getActiveMapForViewer('player', playerId);
  if (!projection) {
    return res.status(404).json({ message: 'Aucune carte active.' });
  }

  res.json(projection);
});

// V1.13.11 — Ouvrir ou fermer toutes les portes d'un coup.
app.post('/api/maps/:mapId/portes', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.basculerPortes(req.params.mapId, req.body?.fermer === true);
  if (!result.success) {
    return res.status(result.message === 'Carte introuvable.' ? 404 : 400)
      .json({ message: result.message });
  }

  emitMapState();
  res.json({
    message: (req.body?.fermer === true ? 'Portes fermées : ' : 'Portes ouvertes : ')
      + result.touchees + '.',
    touchees: result.touchees
  });
});

app.post('/api/maps/:mapId/activate', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  if (!mapStore.getMapById(req.params.mapId)) {
    return res.status(404).json({ message: 'Carte introuvable.' });
  }

  const result = setActiveMapId(req.params.mapId);
  if (!result.success) return res.status(500).json({ message: result.message });

  io.emit('mapLibraryUpdated');
  emitMapState();
  res.json({ message: 'Carte chargée pour toute la table.', activeMapId: result.activeMapId });
});

/**
 * Lecture de la carte active, filtrée pour le demandeur.
 * C'est la seule route de lecture accessible aux joueurs.
 */
app.get('/api/map/active', (req, res) => {
  try {
    const vue = getActiveMapForViewer(roleDepuisRequete(req), playerIdDepuisRequete(req));
    res.json({ map: vue, activeMapId: getActiveMapId() });
  } catch (error) {
    console.error('Erreur lors du chargement de la carte active:', error);
    res.status(500).json({ message: 'Impossible de charger la carte active.' });
  }
});

// --- Palette de décors -------------------------------------------------
//
// mapgen.js ne contient plus que le catalogue des décors par type de lieu.

/**
 * Palette de décors adaptée à un type de lieu.
 *
 * C'est ce qui permet au MJ de poser « un arbre » dans une forêt et
 * « un tonneau » dans une taverne, au lieu de sept types génériques.
 * Un type inconnu renvoie la palette complète : le MJ n'est jamais
 * bloqué sur une carte dessinée à la main.
 */
app.get('/api/map/palette', (req, res) => {
  res.json(mapGen.getPalette(typeof req.query?.type === 'string' ? req.query.type : ''));
});

// --- Tokens (entités mobiles) --------------------------------------

app.post('/api/maps/:mapId/tokens', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.placerToken(req.params.mapId, req.body || {});
  if (!result.success) return res.status(400).json({ message: result.message });

  emitMapState();
  res.status(201).json({ message: 'Token placé.', tokenId: result.tokenId });
});

app.put('/api/maps/:mapId/tokens/:tokenId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.updateToken(req.params.mapId, req.params.tokenId, req.body || {});
  if (!result.success) return res.status(404).json({ message: result.message });

  emitMapState();
  res.json({ message: 'Token mis à jour.', tokenId: result.tokenId });
});

app.delete('/api/maps/:mapId/tokens/:tokenId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.retirerToken(req.params.mapId, req.params.tokenId);
  if (!result.success) return res.status(404).json({ message: result.message });

  emitMapState();
  res.json({ message: 'Token retiré de la carte.' });
});

/**
 * Crée un mob depuis un template ET le place sur la carte en une action.
 * Réutilise intégralement mob.js et session.js : un NPC de carte EST un
 * mob de la partie, éditable depuis l'interface MJ existante.
 */
app.post('/api/maps/:mapId/spawn-mob', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  try {
    const { templateId, x, y } = req.body || {};
    const mobsExistants = getSessionMobs();

    // Dans les deux cas, l'instance reçoit un nom distinct : trois
    // créatures issues du même modèle ne doivent pas être homonymes.
    const mob = templateId
      ? createMobFromTemplate(templateId, req.body?.overrides || {}, { mobsExistants })
      : normaliserMob({
          ...(req.body?.mob || {}),
          nom: nommerInstance(req.body?.mob?.nom || 'Créature', mobsExistants)
        });

    if (!mob) return res.status(404).json({ message: 'Template de mob introuvable.' });
    if (!sauvegarderMobSession(mob)) {
      return res.status(500).json({ message: 'Impossible de créer le mob dans la partie.' });
    }

    const result = mapStore.placerToken(req.params.mapId, {
      kind: 'mob',
      entityId: mob.id,
      x,
      y,
      visibleToPlayers: req.body?.visibleToPlayers !== false
    });

    if (!result.success) return res.status(400).json({ message: result.message });

    io.emit('mobUpdated', { type: 'createdOnMap', mob });
    io.emit('sceneUpdated');
    emitMapState();
    res.status(201).json({ message: 'Créature ajoutée à la carte.', mob, tokenId: result.tokenId });
  } catch (error) {
    console.error('Erreur lors de la création du mob sur la carte:', error);
    res.status(500).json({ message: 'Impossible de créer la créature.' });
  }
});

// --- Éléments statiques (décor, obstacles, objets) -----------------

app.post('/api/maps/:mapId/elements', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  // Le client peut désigner un pinceau de la palette (`brush`) plutôt que
  // de réécrire tout le descripteur : c'est le serveur qui le résout, il
  // ne fait jamais confiance aux propriétés envoyées pour un pinceau connu.
  let donnees = req.body || {};
  if (typeof donnees.brush === 'string' && donnees.brush) {
    const materiau = mapGen.getMateriau(donnees.brush);
    if (!materiau) return res.status(400).json({ message: 'Pinceau de décor inconnu.' });
    donnees = { ...donnees, ...materiau };
    // Le MJ garde la main sur le nom et les notes qu'il ajoute.
    if (req.body.nom) donnees.nom = req.body.nom;
    if (req.body.gmNotes) donnees.gmNotes = req.body.gmNotes;
  }

  const result = mapStore.ajouterElement(req.params.mapId, donnees);
  if (!result.success) return res.status(400).json({ message: result.message });

  emitMapState();
  res.status(201).json({ message: 'Élément ajouté.', elementId: result.elementId });
});

/**
 * Pose PAR LOT : un seul aller-retour pour tout un trace au pinceau.
 * Le pinceau est resolu par le SERVEUR, comme pour la pose unitaire.
 */
app.post('/api/maps/:mapId/elements/batch', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const cellules = Array.isArray(req.body?.cells) ? req.body.cells : [];
  if (!cellules.length) return res.status(400).json({ message: 'Aucune case fournie.' });
  if (cellules.length > 2000) {
    return res.status(400).json({ message: 'Trop de cases en une seule pose (2000 maximum).' });
  }

  let modele = {};
  if (typeof req.body?.brush === 'string' && req.body.brush) {
    const materiau = mapGen.getMateriau(req.body.brush);
    if (!materiau) return res.status(400).json({ message: 'Pinceau de decor inconnu.' });
    modele = materiau;
  } else if (typeof req.body?.kind === 'string') {
    modele = { kind: req.body.kind };
  }

  if (req.body?.nom) modele = { ...modele, nom: req.body.nom };
  // Pinceau de couleur du MJ : la couleur est validée par map.js (#rrggbb).
  if (typeof req.body?.color === 'string') modele = { ...modele, color: req.body.color };

  const liste = cellules.map(cellule => ({ ...modele, x: cellule?.x, y: cellule?.y }));
  const result = mapStore.ajouterElements(req.params.mapId, liste);
  if (!result.success) return res.status(400).json({ message: result.message });

  emitMapState();
  res.status(201).json({
    message: `${result.elementIds.length} element(s) pose(s).`,
    elementIds: result.elementIds
  });
});

app.put('/api/maps/:mapId/elements/:elementId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.updateElement(req.params.mapId, req.params.elementId, req.body || {});
  if (!result.success) return res.status(404).json({ message: result.message });

  emitMapState();
  res.json({ message: 'Élément modifié.', elementId: result.elementId });
});

app.delete('/api/maps/:mapId/elements/:elementId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.supprimerElement(req.params.mapId, req.params.elementId);
  if (!result.success) return res.status(404).json({ message: result.message });

  emitMapState();
  res.json({ message: 'Élément supprimé.' });
});

/** Retrait par lot : une seule mutation pour annuler toute une pose. */
app.delete('/api/maps/:mapId/elements', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const ids = Array.isArray(req.body?.elementIds) ? req.body.elementIds : [];
  if (ids.length > 2000) {
    return res.status(400).json({ message: 'Trop d\'éléments en une seule fois (2000 maximum).' });
  }

  const result = mapStore.supprimerElements(req.params.mapId, ids);
  if (!result.success) return res.status(400).json({ message: result.message });

  emitMapState();
  res.json({ message: `${result.retires} élément(s) retiré(s).`, retires: result.retires });
});

// --- Annotations : le tableau blanc posé sur la carte --------------
//
// Contrairement au tableau blanc V1.10, dont les tracés étaient
// simplement rediffusés et perdus au rechargement, une annotation de
// carte est persistée, attribuée à un auteur et filtrée par rôle.
//
// Le tracé en cours est diffusé par Socket.IO (aperçu, aucune écriture),
// puis enregistré en une seule requête au relâchement du pointeur.

app.post('/api/maps/:mapId/annotations', (req, res) => {
  const role = roleDepuisRequete(req);
  const playerId = playerIdDepuisRequete(req);

  if (role !== 'mj' && (!playerId || !getJoueurById(playerId))) {
    return res.status(403).json({ message: 'Personnage inconnu.' });
  }

  const result = mapStore.ajouterAnnotation(req.params.mapId, req.body || {}, { role, playerId });
  if (!result.success) {
    return res.status(result.message === 'Carte introuvable.' ? 404 : 400)
      .json({ message: result.message });
  }

  emitMapState();
  res.status(201).json({ message: 'Annotation enregistrée.', annotationId: result.annotationId });
});

app.delete('/api/maps/:mapId/annotations/:annotationId', (req, res) => {
  const role = roleDepuisRequete(req);
  const playerId = playerIdDepuisRequete(req);

  const result = mapStore.supprimerAnnotation(
    req.params.mapId,
    req.params.annotationId,
    { role, playerId }
  );

  if (!result.success) {
    const refus = result.message.startsWith('Vous ne pouvez');
    return res.status(refus ? 403 : 404).json({ message: result.message });
  }

  emitMapState();
  res.json({ message: 'Annotation effacée.' });
});

app.delete('/api/maps/:mapId/annotations', (req, res) => {
  const role = roleDepuisRequete(req);
  const playerId = playerIdDepuisRequete(req);

  const result = mapStore.viderAnnotations(
    req.params.mapId,
    req.body?.scope || 'all',
    { role, playerId }
  );

  if (!result.success) return res.status(404).json({ message: result.message });

  emitMapState();
  res.json({ message: `${result.retirees} annotation(s) effacée(s).`, retirees: result.retirees });
});

app.put('/api/maps/:mapId/drawing', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.setDrawingConfig(req.params.mapId, {
    playersAllowed: req.body?.playersAllowed === true
  });

  if (!result.success) return res.status(404).json({ message: result.message });

  emitMapState();
  res.json({
    message: result.map.drawing.playersAllowed
      ? 'Les joueurs peuvent annoter la carte.'
      : 'Les annotations des joueurs sont désactivées.',
    drawing: result.map.drawing
  });
});

// --- Brouillard de guerre & vision ---------------------------------

app.put('/api/maps/:mapId/fog', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  // Ne transmettre que les champs réellement fournis : setFogConfig
  // fusionne avec l'état courant, et une clé présente mais `undefined`
  // écraserait silencieusement le réglage existant.
  const reglages = {};
  if (typeof req.body?.enabled === 'boolean') reglages.enabled = req.body.enabled;
  if (typeof req.body?.mode === 'string') reglages.mode = req.body.mode;
  if (typeof req.body?.autoReveal === 'boolean') reglages.autoReveal = req.body.autoReveal;

  const result = mapStore.setFogConfig(req.params.mapId, reglages);

  if (!result.success) return res.status(404).json({ message: result.message });

  // Activer la vision doit immédiatement refléter ce que le groupe voit.
  mapStore.rafraichirExploration(req.params.mapId);
  emitMapState();
  res.json({ message: 'Brouillard de guerre mis à jour.', fog: result.map.fog });
});

app.post('/api/maps/:mapId/fog/cells', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.revelerCellules(
    req.params.mapId,
    req.body?.cells,
    req.body?.revealed !== false
  );

  if (!result.success) return res.status(400).json({ message: result.message });

  emitMapState();
  res.json({ message: 'Zones mises à jour.', revealedCount: result.revealedCount });
});

app.post('/api/maps/:mapId/fog/reset', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.resetFog(req.params.mapId);
  if (!result.success) return res.status(404).json({ message: result.message });

  emitMapState();
  res.json({ message: 'Brouillard de guerre réinitialisé.' });
});

module.exports = instanceIo => {
  io = instanceIo;
  return app;
};
