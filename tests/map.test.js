// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
// tests/map.test.js
// ---------------------------------------------------------------------------
// V1.13 — Système de cartes : modèle, droits, vision et non-exposition
// des informations réservées au MJ.
//
// Convention du projet : script Node autonome, `throw` en cas d'échec,
// restauration systématique des fichiers de données dans le `finally`.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const mapsFile = bacDonnees.chemin('maps.json');
const sessionFile = bacDonnees.chemin('session.json');

const originalMaps = fs.existsSync(mapsFile) ? fs.readFileSync(mapsFile, 'utf8') : null;
const originalSession = fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile, 'utf8') : null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  delete require.cache[require.resolve('../map')];
  let mapStore = require("../map");

  // Entités fictives : le module map.js ne connaît pas session.js, les
  // données d'entité lui sont toujours injectées.
  const SECRET = '__NOTE_RESERVEE_MJ__';
  const entities = {
    players: [
      { id: 'char_test_a', nom: 'Alix', hp: { current: 10, max: 10 }, statuts: [] },
      { id: 'char_test_b', nom: 'Bram', hp: { current: 8, max: 12 }, statuts: [] }
    ],
    mobs: [
      {
        id: 'mob_test_1', nom: 'Gobelin', hp: { current: 5, max: 5 },
        mana: { current: 0, max: 0 }, statut: 'vivant', notes: SECRET
      },
      {
        id: 'mob_test_2', nom: 'Ombre', hp: { current: 9, max: 9 },
        mana: { current: 0, max: 0 }, statut: 'vivant', notes: ''
      }
    ]
  };

  // ---------------------------------------------------------------------
  // 1. Création et normalisation
  // ---------------------------------------------------------------------
  const creation = mapStore.createMap({
    nom: '__TEST_MAP__',
    grid: { cols: 12, rows: 10, cellSize: 40 }
  });

  assert(creation.success, 'Création de carte impossible.');
  const mapId = creation.map.id;
  assert(creation.map.grid.cols === 12 && creation.map.grid.rows === 10, 'Grille non appliquée.');

  // V1.13.4 : le brouillard est ACTIF PAR DÉFAUT. Un joueur ne doit pas
  // recevoir la carte entière par simple effet de bord de sa création.
  assert(creation.map.fog.enabled === true,
    'Le brouillard de guerre doit être actif par défaut.');
  assert(creation.map.fog.mode === 'vision',
    'Le mode par défaut doit être la vision des personnages.');

  // Migration : un choix explicite antérieur reste respecté.
  const sansBrouillard = mapStore.createMap({ nom: '__TEST_SANS_FOG__', fog: { enabled: false } });
  assert(sansBrouillard.map.fog.enabled === false,
    'Une carte ayant explicitement désactivé le brouillard doit conserver ce choix.');
  mapStore.deleteMap(sansBrouillard.map.id);

  // ---------------------------------------------------------------------
  // V1.13.7 — Garde-fou d'obsolescence
  //
  // Une perte complète de maps.json a été observée. Le mécanisme : un
  // module dont la vue mémoire ne reflète plus le fichier écrase au
  // premier enregistrement tout ce qu'il ignore. On refuse désormais.
  // ---------------------------------------------------------------------
  const temoin = mapStore.createMap({ nom: '__TEST_OBSOLESCENCE__', grid: { cols: 9, rows: 9 } });
  assert(temoin.success, 'Création du témoin impossible.');

  const contenuAvant = fs.readFileSync(mapsFile, 'utf8');

  // Un tiers réécrit le fichier dans le dos du module.
  fs.writeFileSync(mapsFile, JSON.stringify({ formatVersion: 1, maps: {} }, null, 2), 'utf8');

  const perimee = mapStore.createMap({ nom: '__TEST_PERIMEE__', grid: { cols: 11, rows: 11 } });
  assert(!perimee.success,
    'Une écriture depuis une vue périmée doit être refusée, pas appliquée.');
  assert(Object.keys(JSON.parse(fs.readFileSync(mapsFile, 'utf8')).maps).length === 0,
    'Le fichier ne doit pas avoir été ré-écrasé par la vue périmée.');

  // On remet le fichier tel que le module le croit, et tout redevient normal.
  fs.writeFileSync(mapsFile, contenuAvant, 'utf8');
  delete require.cache[require.resolve('../map')];
  mapStore = require('../map');
  mapStore.activerBrouillard(true); // désactivé dans l'appli, toujours testé
  assert(mapStore.deleteMap(temoin.map.id).success,
    'Après rechargement, les écritures doivent redevenir possibles.');

  // ---------------------------------------------------------------------
  // 1 bis. V1.13.5 — Garde-fou anti-doublon
  //
  // Quatre villes strictement identiques avaient été créées par clics
  // répétés, sans aucun retour visuel. Le contrôle porte sur le CONTENU
  // (type, grille, décor), pas sur le nom.
  // ---------------------------------------------------------------------
  const gabarit = { type: 'foret', grid: { cols: 14, rows: 12 }, elements: [{ kind: 'mur', x: 2, y: 2 }] };

  const original1 = mapStore.createMap({ ...gabarit, nom: '__TEST_DOUBLON_A__' });
  assert(original1.success, 'La première carte doit être acceptée.');

  const doublon = mapStore.createMap({ ...gabarit, nom: '__TEST_DOUBLON_B__' });
  assert(!doublon.success, 'Une carte au contenu identique doit être refusée.');
  assert(doublon.duplicate === true, 'Le refus doit être signalé comme un doublon.');
  assert(doublon.existingMapId === original1.map.id,
    'Le refus doit désigner la carte déjà présente.');

  // Une carte de contenu différent passe, même sous un nom proche.
  const variante = mapStore.createMap({
    ...gabarit, nom: '__TEST_DOUBLON_A__', elements: [{ kind: 'mur', x: 3, y: 2 }]
  });
  assert(variante.success, 'Un décor différent ne doit pas être considéré comme un doublon.');

  // Dupliquer est une intention explicite : le contrôle ne doit pas gêner.
  const copie = mapStore.duplicateMap(original1.map.id);
  assert(copie.success, 'La duplication explicite doit rester possible.');
  assert(copie.map.id !== original1.map.id, 'La copie doit avoir son propre identifiant.');

  [original1.map.id, variante.map.id, copie.map.id].forEach(id => mapStore.deleteMap(id));

  // Les valeurs hors bornes sont ramenées dans le domaine autorisé.
  const bornes = mapStore.createMap({ nom: '__TEST_BORNES__', grid: { cols: 9999, rows: -3 } });
  assert(bornes.map.grid.cols <= 160 && bornes.map.grid.rows >= 4, 'Bornes de grille non respectées.');
  mapStore.deleteMap(bornes.map.id);

  // ---------------------------------------------------------------------
  // V1.13.8 — Sources de lumière
  //
  // On voit DE PRÈS même dans le noir, et DE LOIN ce qui est éclairé et
  // dégagé. Propriété de sûreté : sans lumière, rien ne change.
  // ---------------------------------------------------------------------
  const lum = mapStore.createMap({
    nom: '__TEST_LUMIERE__', grid: { cols: 30, rows: 9 },
    fog: { enabled: true, mode: 'vision' }
  });
  const lumId = lum.map.id;
  mapStore.placerToken(lumId, { kind: 'player', entityId: 'char_lum', x: 1, y: 4, vision: { range: 3 } });

  // NEUTRALITÉ : sans aucune source, le nouveau chemin doit donner
  // exactement le même résultat que le calcul historique.
  const carteSansLumiere = mapStore.getMapById(lumId);
  const historique = mapStore.calculerCellulesVisibles(carteSansLumiere,
    [{ x: 1, y: 4, range: 3 }]);
  const nouvelle = mapStore.visionDuPersonnage(carteSansLumiere, 'char_lum');

  assert(historique.size === nouvelle.size
    && [...historique].every(c => nouvelle.has(c)),
    'Sans lumière, la vision doit être rigoureusement inchangée.');
  assert(mapStore.originesLumiere(carteSansLumiere).length === 0,
    'Aucune source ne doit être détectée sans lightRange.');

  const sansLumiere = nouvelle.size;

  // EFFET : une torche hors de portée naturelle, mais en ligne de vue.
  mapStore.ajouterElement(lumId, { kind: 'marqueur', nom: 'Torche', x: 12, y: 4, lightRange: 4 });
  const carteEclairee = mapStore.getMapById(lumId);

  assert(mapStore.originesLumiere(carteEclairee).length === 1,
    'La torche doit être détectée comme source.');
  const avecLumiere = mapStore.visionDuPersonnage(carteEclairee, 'char_lum').size;
  assert(avecLumiere > sansLumiere,
    `Une torche en ligne de vue doit élargir la vision (${sansLumiere} -> ${avecLumiere}).`);

  // OCCLUSION : un mur entre le personnage et la torche annule l'effet.
  mapStore.ajouterElement(lumId, { kind: 'mur', x: 7, y: 0, w: 1, h: 9 });
  const derriereMur = mapStore.visionDuPersonnage(mapStore.getMapById(lumId), 'char_lum').size;
  assert(derriereMur === sansLumiere,
    `Une torche derrière un mur ne doit rien révéler (${derriereMur} au lieu de ${sansLumiere}).`);

  // NON-EXPOSITION : lightRange renseignerait sur la carte, au même titre
  // que blocksVision. Il ne doit jamais parvenir au joueur.
  const vueLum = mapStore.getMapForViewer(lumId, {
    role: 'player', playerId: 'char_lum',
    entities: { players: [{ id: 'char_lum', nom: 'Alix', hp: { current: 5, max: 5 }, statuts: [] }], mobs: [] }
  });
  assert(!JSON.stringify(vueLum).includes('lightRange'),
    'lightRange ne doit jamais être transmis au joueur.');
  assert(JSON.stringify(mapStore.getMapForViewer(lumId, { role: 'mj', entities: { players: [], mobs: [] } }))
    .includes('lightRange'),
    'Le MJ doit conserver la portée de lumière de ses éléments.');

  mapStore.deleteMap(lumId);

  // ---------------------------------------------------------------------
  // 2. Tokens et éléments
  // ---------------------------------------------------------------------
  assert(mapStore.placerToken(mapId, { kind: 'player', entityId: 'char_test_a', x: 1, y: 1, vision: { range: 4 } }).success,
    'Placement du personnage A impossible.');
  assert(mapStore.placerToken(mapId, { kind: 'player', entityId: 'char_test_b', x: 10, y: 8 }).success,
    'Placement du personnage B impossible.');
  assert(mapStore.placerToken(mapId, { kind: 'mob', entityId: 'mob_test_1', x: 2, y: 1, gmNotes: SECRET }).success,
    'Placement du gobelin impossible.');
  assert(mapStore.placerToken(mapId, { kind: 'mob', entityId: 'mob_test_2', x: 1, y: 2, visibleToPlayers: false }).success,
    "Placement de la créature cachée impossible.");

  // Un mur vertical coupe la carte en deux : il bloque vision ET passage.
  const mur = mapStore.ajouterElement(mapId, { kind: 'mur', x: 5, y: 0, w: 1, h: 10, gmNotes: SECRET });
  assert(mur.success, 'Ajout du mur impossible.');
  assert(mur.map.elements[mur.elementId].blocksVision === true, 'Un mur doit bloquer la vision.');
  assert(mur.map.elements[mur.elementId].blocksMovement === true, 'Un mur doit bloquer le déplacement.');

  // Un élément secret : présent pour le MJ, jamais transmis aux joueurs.
  const piege = mapStore.ajouterElement(mapId, {
    kind: 'piege', x: 2, y: 2, visibleToPlayers: false, gmNotes: SECRET
  });
  assert(piege.success, 'Ajout du piège impossible.');

  // ---------------------------------------------------------------------
  // V1.13.6 — Pose PAR LOT
  //
  // Le pinceau envoyait une requête, une mutation et une diffusion temps
  // réel PAR CASE. Un seul appel doit désormais suffire.
  // ---------------------------------------------------------------------
  const avantLot = Object.keys(mapStore.getMapById(mapId).elements).length;
  const lot = mapStore.ajouterElements(mapId, [
    { kind: 'decor', x: 8, y: 8 },
    { kind: 'decor', x: 9, y: 8 },
    { kind: 'decor', x: 10, y: 8 }
  ]);

  assert(lot.success, 'Pose par lot impossible.');
  assert(lot.elementIds.length === 3, 'Les trois éléments doivent être créés.');
  assert(new Set(lot.elementIds).size === 3, 'Chaque élément doit avoir un identifiant unique.');
  assert(Object.keys(lot.map.elements).length === avantLot + 3,
    'Le lot doit produire exactement trois éléments de plus.');

  assert(!mapStore.ajouterElements(mapId, []).success, 'Un lot vide doit être refusé.');
  assert(!mapStore.ajouterElements(mapId, 'pas un tableau').success,
    'Un lot mal formé doit être refusé.');

  // Retrait par lot (annulation Ctrl + Z d'une pose au pinceau) : une
  // seule mutation, et les identifiants inconnus sont ignorés.
  const retrait = mapStore.supprimerElements(mapId, [...lot.elementIds, 'elem_inexistant']);
  assert(retrait.success && retrait.retires === 3, 'Le retrait par lot doit retirer les trois éléments.');
  assert(Object.keys(mapStore.getMapById(mapId).elements).length === avantLot,
    'Après retrait du lot, le décor doit revenir à son état précédent.');
  assert(!mapStore.supprimerElements(mapId, []).success, 'Un retrait vide doit être refusé.');

  // ---------------------------------------------------------------------
  // V1.13.6 — Placement automatique sans coordonnées
  //
  // Le Bestiaire pose une créature en un clic : le serveur doit choisir
  // une case PRATICABLE, et de préférence près du groupe — pas le coin
  // 0,0 que renvoyait un balayage naïf.
  // ---------------------------------------------------------------------
  const auto = mapStore.placerToken(mapId, { kind: 'mob', entityId: 'mob_auto_test' });
  assert(auto.success, 'Placement automatique impossible.');

  const carteAuto = mapStore.getMapById(mapId);
  const tokenAuto = carteAuto.tokens[auto.tokenId];
  const murs = mapStore.cellulesBloquantes(carteAuto, 'movement');

  assert(!murs.has(`${tokenAuto.x},${tokenAuto.y}`),
    `Le placement automatique a choisi une case bloquante (${tokenAuto.x},${tokenAuto.y}).`);

  const autresTokens = Object.values(carteAuto.tokens).filter(t => t.id !== tokenAuto.id);
  assert(!autresTokens.some(t => t.x === tokenAuto.x && t.y === tokenAuto.y),
    'Le placement automatique ne doit pas superposer deux tokens.');

  // Il doit viser le groupe, pas un coin de la carte.
  const persos = autresTokens.filter(t => t.kind === 'player');
  if (persos.length) {
    const cx = Math.round(persos.reduce((total, t) => total + t.x, 0) / persos.length);
    const cy = Math.round(persos.reduce((total, t) => total + t.y, 0) / persos.length);
    const distance = Math.max(Math.abs(tokenAuto.x - cx), Math.abs(tokenAuto.y - cy));
    assert(distance <= 6,
      `Le placement automatique doit rester près du groupe (distance ${distance}).`);
  }

  mapStore.retirerToken(mapId, auto.tokenId);

  // ---------------------------------------------------------------------
  // 3. Déplacement autoritaire : les droits sont vérifiés côté serveur
  // ---------------------------------------------------------------------
  const monDeplacement = mapStore.deplacerToken(mapId, 'player:char_test_a', 3, 1,
    { role: 'player', playerId: 'char_test_a' });
  assert(monDeplacement.success, 'Un joueur doit pouvoir déplacer son propre personnage.');

  const deplacementAutrui = mapStore.deplacerToken(mapId, 'player:char_test_b', 3, 3,
    { role: 'player', playerId: 'char_test_a' });
  assert(!deplacementAutrui.success, "Un joueur ne doit pas pouvoir déplacer le personnage d'un autre.");

  const deplacementMob = mapStore.deplacerToken(mapId, 'mob:mob_test_1', 4, 4,
    { role: 'player', playerId: 'char_test_a' });
  assert(!deplacementMob.success, 'Un joueur ne doit pas pouvoir déplacer une créature.');

  const dansLeMur = mapStore.deplacerToken(mapId, 'player:char_test_a', 5, 1,
    { role: 'player', playerId: 'char_test_a' });
  assert(!dansLeMur.success, 'Un joueur ne doit pas pouvoir traverser un mur.');

  const mjDansLeMur = mapStore.deplacerToken(mapId, 'mob:mob_test_1', 5, 5, { role: 'mj' });
  assert(mjDansLeMur.success, 'Le MJ doit pouvoir placer une créature où il veut.');
  mapStore.deplacerToken(mapId, 'mob:mob_test_1', 2, 1, { role: 'mj' });

  const horsCarte = mapStore.deplacerToken(mapId, 'player:char_test_a', 99, 99, { role: 'mj' });
  assert(!horsCarte.success, 'Une position hors de la carte doit être refusée.');

  // ---------------------------------------------------------------------
  // 4. Ligne de vue
  // ---------------------------------------------------------------------
  const carteCourante = mapStore.getMapById(mapId);
  const bloquantes = mapStore.cellulesBloquantes(carteCourante, 'vision');
  assert(bloquantes.has('5,1'), 'Le mur doit figurer dans les cases bloquant la vision.');
  assert(!mapStore.ligneDeVueDegagee(3, 1, 8, 1, bloquantes), 'Le mur doit couper la ligne de vue.');
  assert(mapStore.ligneDeVueDegagee(1, 1, 4, 1, bloquantes), 'La ligne de vue dégagée doit passer.');

  const visibles = mapStore.calculerCellulesVisibles(carteCourante, [{ x: 3, y: 1, range: 4 }]);
  assert(visibles.has('2,1'), 'Une case proche et dégagée doit être visible.');
  assert(!visibles.has('7,1'), "Une case derrière un mur ne doit jamais être visible.");

  // ---------------------------------------------------------------------
  // 5. Brouillard de guerre — mode vision
  // ---------------------------------------------------------------------
  assert(mapStore.setFogConfig(mapId, { enabled: true, mode: 'vision', autoReveal: true }).success,
    'Configuration du brouillard impossible.');

  const vueMj = mapStore.getMapForViewer(mapId, { role: 'mj', entities });
  const vueJoueurA = mapStore.getMapForViewer(mapId, { role: 'player', playerId: 'char_test_a', entities });

  assert(vueMj.role === 'mj' && vueJoueurA.role === 'player', 'Rôle de projection incorrect.');

  // Le MJ voit tout.
  assert(Object.keys(vueMj.tokens).length === 4, 'Le MJ doit voir les 4 tokens.');
  assert(vueMj.elements[piege.elementId], 'Le MJ doit voir le piège caché.');
  assert(vueMj.playerVision, 'Le MJ doit disposer de l\'aperçu du champ de vision du groupe.');

  // Le joueur ne voit que ce que son personnage voit.
  assert(vueJoueurA.tokens['player:char_test_a'], 'Le joueur doit voir son propre personnage.');
  assert(vueJoueurA.tokens['player:char_test_a'].own === true, 'Son propre token doit être marqué `own`.');
  assert(vueJoueurA.tokens['mob:mob_test_1'], 'Le joueur doit voir la créature proche et visible.');
  assert(!vueJoueurA.tokens['mob:mob_test_2'], 'Une créature cachée par le MJ ne doit jamais être transmise.');
  assert(!vueJoueurA.tokens['player:char_test_b'], "Un personnage derrière un mur ne doit pas être transmis.");
  assert(!vueJoueurA.elements[piege.elementId], 'Un élément secret ne doit jamais être transmis.');

  // ---------------------------------------------------------------------
  // 6. Non-exposition des données réservées au MJ
  // ---------------------------------------------------------------------
  const chargeUtileJoueur = JSON.stringify(vueJoueurA);
  assert(!chargeUtileJoueur.includes(SECRET), 'Une note MJ a fuité dans la charge utile joueur.');
  assert(!chargeUtileJoueur.includes('gmNotes'), 'Le champ gmNotes ne doit pas exister côté joueur.');
  assert(!chargeUtileJoueur.includes('blocksVision'), 'blocksVision révèle la structure des murs : à ne pas transmettre.');
  assert(!chargeUtileJoueur.includes('visibleToPlayers'), 'visibleToPlayers ne doit pas être transmis au joueur.');
  assert(JSON.stringify(vueMj).includes(SECRET), 'Le MJ doit conserver ses notes.');

  // La vision est propre à chaque personnage.
  const vueJoueurB = mapStore.getMapForViewer(mapId, { role: 'player', playerId: 'char_test_b', entities });
  assert(vueJoueurB.tokens['player:char_test_b'], 'Le joueur B doit voir son propre personnage.');
  assert(!vueJoueurB.tokens['player:char_test_a'], 'Le joueur B ne doit pas voir A, séparé par le mur.');
  assert(JSON.stringify(vueJoueurA.vision.visible) !== JSON.stringify(vueJoueurB.vision.visible),
    'Deux personnages ne doivent pas partager le même champ de vision.');

  // Écran partagé : ce que voit le GROUPE (A et B), filtré comme un joueur.
  const vueEcran = mapStore.getMapForViewer(mapId, { role: 'ecran', entities });
  assert(vueEcran.role === 'ecran' && vueEcran.playerId === null && vueEcran.self === null,
    "La projection écran n'appartient à aucun personnage.");
  assert(vueEcran.tokens['player:char_test_a'] && vueEcran.tokens['player:char_test_b'],
    "L'écran doit voir les deux personnages, de part et d'autre du mur.");
  assert(vueEcran.tokens['mob:mob_test_1'], "L'écran doit voir la créature visible du groupe.");
  assert(!vueEcran.tokens['mob:mob_test_2'], "Une créature cachée par le MJ ne doit pas apparaître à l'écran.");
  assert(!vueEcran.elements[piege.elementId], "Un élément secret ne doit pas apparaître à l'écran.");
  const visiblesEcran = new Set(vueEcran.vision.visible);
  assert([...vueJoueurA.vision.visible, ...vueJoueurB.vision.visible].every(c => visiblesEcran.has(c)),
    "La vision de l'écran doit couvrir celle de chaque personnage.");
  const chargeEcran = JSON.stringify(vueEcran);
  assert(!chargeEcran.includes(SECRET) && !chargeEcran.includes('gmNotes') && !chargeEcran.includes('blocksVision'),
    "Aucune donnée réservée au MJ ne doit atteindre l'écran.");
  assert(!Object.values(vueEcran.tokens).some(t => t.own), "Aucun jeton n'appartient à l'écran.");
  assert(!mapStore.deplacerToken(mapId, 'player:char_test_a', 1, 1, { role: 'player', playerId: null }).success,
    "L'écran (sans personnage) ne doit pouvoir déplacer aucun jeton.");

  // ---------------------------------------------------------------------
  // 7. Mémoire d'exploration
  // ---------------------------------------------------------------------
  assert(mapStore.rafraichirExploration(mapId).success, "Rafraîchissement de l'exploration impossible.");
  const apresExploration = mapStore.getMapById(mapId);
  assert(apresExploration.fog.revealed.length > 0, "Les cases vues doivent être mémorisées comme explorées.");

  const vueApres = mapStore.getMapForViewer(mapId, { role: 'player', playerId: 'char_test_a', entities });
  assert(Array.isArray(vueApres.vision.explored), 'Le joueur doit recevoir la liste des cases explorées.');
  // Une case explorée mais non visible ne doit révéler aucune entité.
  const tokensHorsVue = Object.values(vueApres.tokens)
    .filter(t => !vueApres.vision.visible.includes(`${t.x},${t.y}`) && !t.own);
  assert(tokensHorsVue.length === 0, "Aucune entité ne doit être transmise hors du champ de vision actuel.");

  // ---------------------------------------------------------------------
  // 8. Brouillard manuel
  // ---------------------------------------------------------------------
  mapStore.resetFog(mapId);
  mapStore.setFogConfig(mapId, { enabled: true, mode: 'manual' });

  const vueManuelVide = mapStore.getMapForViewer(mapId, { role: 'player', playerId: 'char_test_a', entities });
  assert(vueManuelVide.vision.visible.length === 0, 'En mode manuel, rien ne doit être visible avant révélation.');

  assert(mapStore.revelerCellules(mapId, [{ x: 3, y: 1 }, { x: 2, y: 1 }], true).success,
    'Révélation manuelle impossible.');
  const vueManuel = mapStore.getMapForViewer(mapId, { role: 'player', playerId: 'char_test_a', entities });
  assert(vueManuel.tokens['mob:mob_test_1'], 'Une case révélée par le MJ doit exposer la créature qui s\'y trouve.');

  assert(mapStore.revelerCellules(mapId, [{ x: 2, y: 1 }], false).success, 'Masquage manuel impossible.');
  const vueMasquee = mapStore.getMapForViewer(mapId, { role: 'player', playerId: 'char_test_a', entities });
  assert(!vueMasquee.tokens['mob:mob_test_1'], 'Une case re-masquée doit à nouveau cacher la créature.');

  // ---------------------------------------------------------------------
  // 9. Synchronisation avec l'état de la partie
  // ---------------------------------------------------------------------
  const sync = mapStore.synchroniserTokens(mapId, {
    players: [entities.players[0]],   // Bram a quitté la partie
    mobs: entities.mobs
  });
  assert(sync.success, 'Synchronisation impossible.');
  assert(!sync.map.tokens['player:char_test_b'], "Le token d'un personnage supprimé doit disparaître.");
  assert(sync.map.tokens['player:char_test_a'], 'Le personnage restant doit être conservé.');

  const syncAjout = mapStore.synchroniserTokens(mapId, entities);
  assert(syncAjout.map.tokens['player:char_test_b'], 'Un nouveau personnage doit être placé automatiquement.');

  // ---------------------------------------------------------------------
  // 10. Persistance et carte active de session
  // ---------------------------------------------------------------------
  // Les chemins haute fréquence (déplacement, brouillard, décor) écrivent
  // en différé depuis V1.13.5 : on vide avant toute relecture disque.
  assert(mapStore.flush(), 'Le vidage des écritures en attente a échoué.');

  delete require.cache[require.resolve('../map')];
  const rechargee = require('../map');
  rechargee.activerBrouillard(true); // désactivé dans l'appli, toujours testé
  assert(rechargee.getMapById(mapId), 'La carte doit survivre à un rechargement du module.');
  assert(rechargee.getMaps().some(m => m.id === mapId), 'La carte doit apparaître dans la bibliothèque.');

  delete require.cache[require.resolve('../session')];
  const session = require('../session');
  assert(session.setActiveMapId(mapId).success, "Impossible de définir la carte active.");
  assert(session.getActiveMapId() === mapId, "La carte active n'est pas conservée.");
  assert(session.validerSessionImport({
    id: 'x', players: {}, activeMapId: 42
  }).valid === false, 'Une carte active non textuelle doit être refusée.');

  // Nettoyage de la carte de test.
  assert(rechargee.deleteMap(mapId).success, 'Suppression de la carte de test impossible.');

  // ---------------------------------------------------------------------
  // 11. Câblage serveur et interfaces (convention de vérification statique)
  // ---------------------------------------------------------------------
  const serverSource = require('./_sources').sourceServeur();
  const routesAttendues = [
    "app.get('/api/map/active'",
    "app.post('/api/maps'",
    "app.post('/api/maps/:mapId/activate'",
    "app.post('/api/maps/:mapId/elements'",
    "app.post('/api/maps/:mapId/spawn-mob'",
    "app.put('/api/maps/:mapId/fog'",
    "app.post('/api/maps/:mapId/fog/cells'"
  ];
  routesAttendues.forEach(route => assert(serverSource.includes(route), `Route absente : ${route}`));

  assert(serverSource.includes("socket.on('mapMoveToken'"), 'Événement de déplacement de token absent.');
  assert(serverSource.includes('function emitMapState'), 'Diffusion ciblée de la carte absente.');
  assert(serverSource.includes("map: getActiveMapForViewer('player', playerId)"),
    'La carte doit être incluse dans le snapshot autoritaire du joueur.');
  assert(serverSource.includes("map: getActiveMapForViewer('mj', null)"),
    'La carte doit être incluse dans le snapshot autoritaire du MJ.');
  assert(serverSource.includes('refuserSiPasMj'), 'Contrôle du rôle MJ absent des routes de carte.');

  // ---------------------------------------------------------------------
  // 12. V1.13.5 — Les routes DESTRUCTRICES exigent le rôle MJ
  //
  // Trois routes pouvaient détruire des données sans aucun contrôle, dont
  // l'import de session qui REMPLACE la partie entière.
  // ---------------------------------------------------------------------
  function corpsDeRoute(source, signature) {
    const debut = source.indexOf(signature);
    if (debut === -1) return '';
    // La garde est en tête de route : les 400 premiers caractères suffisent.
    return source.slice(debut, debut + 400);
  }

  [
    "app.post('/api/session/import'",
    "app.delete('/api/joueurs/delete/:id'",
    "app.delete('/api/joueurs/delete-by-name/:nom'"
  ].forEach(signature => {
    const corps = corpsDeRoute(serverSource, signature);
    assert(corps, `Route introuvable : ${signature}`);
    assert(corps.includes('refuserSiPasMj'),
      `Route destructrice sans contrôle de rôle : ${signature}`);
  });

  // Les deux seuls appelants doivent transmettre le rôle, sans quoi
  // l'interface casserait silencieusement.
  // Attention : dans ce fichier, `mjSource` désigne map.html (la Carte MJ).
  // L'interface de gestion, elle, est mj.html — d'où ce nom explicite.
  const interfaceMjSource = fs.readFileSync(path.join(__dirname, '..', 'website', 'mj.html'), 'utf8');
  const selecteurSource = fs.readFileSync(path.join(__dirname, '..', 'website', 'selecte_player.html'), 'utf8');

  assert(/joueurs\/delete\/[\s\S]{0,320}role: 'mj'/.test(selecteurSource),
    "La suppression depuis la liste des joueurs doit transmettre le rôle MJ.");
  assert(/session\/import[\s\S]{0,320}role: 'mj'/.test(interfaceMjSource),
    "L'import de session depuis l'interface MJ doit transmettre le rôle MJ.");

  // Code mort retiré : la route des types génériques n'a plus d'appelant.
  assert(!serverSource.includes("app.get('/api/map/element-kinds'"),
    'La route element-kinds, sans appelant, aurait dû être retirée.');
  assert(!interfaceMjSource.includes('#status-management'),
    'Les règles CSS #status-management, sans élément correspondant, subsistent.');

  // ---------------------------------------------------------------------
  // 13. V1.13.5 — Coque à hauteur verrouillée et canvas ajusté
  //
  // Cause du grand espace vide : resize() ne tenait compte que de la
  // largeur, la carte débordait du viewport et les colonnes latérales
  // s'arrêtaient bien avant.
  // ---------------------------------------------------------------------
  const coreSource = fs.readFileSync(path.join(__dirname, '..', 'website', 'map-core.js'), 'utf8');

  assert(coreSource.includes('dispoH'), 'resize() doit disposer d\'un budget de HAUTEUR.');
  assert(/Math\.min\(dispoL \/ logicalWidth\(\), dispoH \/ logicalHeight\(\)\)/.test(coreSource),
    'L\'échelle doit être la plus contraignante des deux dimensions.');
  assert(!/function resize\(\) \{\s*if \(!state\.map\) return;/.test(coreSource),
    'Sans carte, le canvas doit être dimensionné au conteneur, pas laissé à 600x400.');
  assert(coreSource.includes('setZoom'), 'Le basculement ajusté / agrandi doit être exposé.');

  // ---------------------------------------------------------------------
  // 14. V1.13.6 — Bestiaire : câblage et cloisonnement
  // ---------------------------------------------------------------------
  [
    "app.get('/api/mob-categories'",
    "app.post('/api/mob-templates/:id/duplicate'",
    "app.post('/api/mob-templates/from-mob/:mobId'",
    "app.post('/api/maps/:mapId/elements/batch'"
  ].forEach(signature => {
    assert(serverSource.includes(signature), `Route absente : ${signature}`);
  });

  // Les routes du bestiaire modifient la bibliothèque : rôle MJ exigé.
  ["app.post('/api/mob-templates/:id/duplicate'", "app.post('/api/mob-templates/from-mob/:mobId'"]
    .forEach(signature => {
      const debut = serverSource.indexOf(signature);
      assert(serverSource.slice(debut, debut + 300).includes('refuserSiPasMj'),
        `Route de bestiaire sans contrôle de rôle : ${signature}`);
    });

  // `mjSource` est déclaré plus bas dans ce fichier : on relit ici sous un
  // nom explicite pour éviter la zone morte.
  const carteMjSource = fs.readFileSync(path.join(__dirname, '..', 'website', 'map.html'), 'utf8');

  assert(carteMjSource.includes('data-onglet="bestiaire"'), 'Onglet Bestiaire absent de la Carte MJ.');
  assert(carteMjSource.includes('data-onglet="jeu"'), 'Onglet « En jeu » absent de la Carte MJ.');
  assert(carteMjSource.includes('function chargerBestiaire'),
    'La logique du Bestiaire est absente : les onglets seraient inertes.');
  assert(carteMjSource.includes('function renderMobsEnJeu'), 'Rendu des créatures en jeu absent.');
  assert(carteMjSource.includes('actionBestiaire'), 'Actions du Bestiaire absentes.');
  assert(carteMjSource.includes("socket.on('mobUpdated'"),
    'La liste « En jeu » doit suivre les modifications de créatures en temps réel.');
  assert(carteMjSource.includes('elements/batch'), 'Le pinceau doit poser par lot.');
  assert(!/for \(const cell of cells\)[\s\S]{0,200}\/elements`/.test(carteMjSource),
    'La boucle historique « une requête par case » subsiste.');

  // La carte joueur a été retirée : seuls le MJ et l'Écran affichent la carte.
  assert(!fs.existsSync(path.join(__dirname, '..', 'website', 'map_joueur.html')), 'La carte joueur doit avoir été retirée.');

  ['map.html'].forEach(fichier => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'website', fichier), 'utf8');
    assert(source.includes('100dvh'), `${fichier} : coque à hauteur verrouillée absente.`);
    assert(source.includes('min-height:0') || source.includes('min-height: 0'),
      `${fichier} : min-height:0 absent, le débordement flex réapparaîtrait.`);
    assert(/\.canvas-wrap\s*\{[^}]*flex:\s*1/.test(source),
      `${fichier} : le conteneur de carte doit occuper la hauteur restante.`);
  });

  const mjSource = fs.readFileSync(path.join(__dirname, '..', 'website', 'map.html'), 'utf8');

  // Le brouillard est désactivé dans l'application : plus d'outil côté MJ.
  assert(!mjSource.includes("data-tool=\"fog-reveal\""), 'Les outils de brouillard ne doivent plus être proposés.');
  assert(mjSource.includes('spawn-mob'), 'Ajout de créature absent de l\'interface MJ.');
  assert(mjSource.includes('gmNotes'), 'Champ de notes MJ absent de l\'inspecteur.');
  const ecranSource = fs.readFileSync(path.join(__dirname, '..', 'website', 'ecran.html'), 'utf8');
  assert(!ecranSource.includes("role: 'mj'") && !ecranSource.includes('gmNotes'), "L'Écran ne doit jamais demander la vue MJ.");
  assert(ecranSource.includes("socket.on('mapState'"), 'Réception temps réel absente de l\'Écran.');

  console.log('PASS: V1.13 cartes — modèle, droits, vision, brouillard et non-exposition MJ');
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

  if (originalSession !== null) {
    fs.writeFileSync(sessionFile, originalSession, 'utf8');
  }

  delete require.cache[require.resolve('../map')];
  delete require.cache[require.resolve('../session')];
}

// ---------------------------------------------------------------------
// V1.13.10 — L'œil du joueur.
//
// Le MJ regarde la carte par les yeux d'un personnage. Le seul risque
// réel est qu'on RECONSTITUE cette vue au lieu de la demander : elle
// divergerait alors, en silence, de ce que le joueur voit vraiment.
// Ces contrôles verrouillent le chemin, pas seulement l'existence.
// ---------------------------------------------------------------------
{
  const serveur = require('./_sources').sourceServeur();
  const carteMj = fs.readFileSync(path.join(__dirname, '..', 'website', 'map.html'), 'utf8');

  const route = serveur.indexOf("app.get('/api/map/vue-joueur/:playerId'");
  assert(route !== -1, 'La route de vue joueur est absente du serveur.');

  // Bornée à la route elle-même : une fenêtre fixe déborderait sur la
  // route suivante et rendrait les assertions trompeuses.
  const corpsRoute = serveur.slice(route, serveur.indexOf('app.', route + 10));
  assert(corpsRoute.includes('refuserSiPasMj'),
    'La vue joueur doit être réservée au MJ : elle expose la position des personnages.');
  assert(corpsRoute.includes("getActiveMapForViewer('player'"),
    'La vue joueur doit passer par la projection joueur existante, jamais être reconstituée.');
  assert(corpsRoute.includes('getJoueurById'),
    'Un identifiant de personnage inconnu doit être refusé.');
  assert(!/emitMapState|io\.emit/.test(corpsRoute),
    'La vue joueur est une lecture : elle ne doit rien diffuser.');

  assert(carteMj.includes('let vueJoueur = null;'), 'État de vue joueur absent du client MJ.');
  assert(carteMj.includes('mod-oeil'), 'Bouton « son point de vue » absent de la modale.');

  // La garde d'édition doit couvrir CE mode aussi, sinon le MJ modifierait
  // la carte en croyant regarder celle d'un joueur.
  const garde = carteMj.indexOf('function refuserSiLectureSeule()');
  assert(garde !== -1, 'Garde de lecture seule introuvable.');
  assert(carteMj.slice(garde, garde + 700).includes('if (!vueJoueur) return false;'),
    'La garde d\'édition doit refuser aussi pendant la vue joueur.');

  // Et la projection MJ ne doit pas écraser ce que le MJ est venu observer.
  const handler = carteMj.indexOf("socket.on('mapState'");
  assert(handler !== -1, 'Handler mapState introuvable.');
  assert(carteMj.slice(handler, handler + 900).includes('rafraichirVueJoueur'),
    'En vue joueur, mapState doit rafraîchir la vue observée, pas la remplacer.');

  console.log('PASS: V1.13.10 œil du joueur — même projection, réservée au MJ, édition bloquée');
}

// ---------------------------------------------------------------------
// V1.13.12 — Une porte s'ouvre aussi côté joueur.
//
// C'est la deuxième action mutante confiée à un joueur, après le
// déplacement de son jeton. Toute la décision reste serveur : ces
// contrôles portent sur les REFUS autant que sur les succès.
// ---------------------------------------------------------------------
{
  // La suite principale a vidé son cache de module dans son `finally` :
  // on recharge, sur le bac à sable déjà en place.
  const mapStore = require('../map');
  mapStore.activerBrouillard(true); // désactivé dans l'appli, toujours testé

  const carte = mapStore.createMap({
    nom: '__TEST_PORTE_JOUEUR__',
    grid: { cols: 20, rows: 9 },
    fog: { enabled: true, mode: 'vision' }
  }, { force: true });
  const idCarte = carte.map.id;

  mapStore.placerToken(idCarte, { kind: 'player', entityId: 'char_porte', x: 7, y: 4, vision: { range: 14 } });
  mapStore.ajouterElement(idCarte, { kind: 'mur', x: 8, y: 0, w: 1, h: 4 });
  mapStore.ajouterElement(idCarte, { kind: 'mur', x: 8, y: 5, w: 1, h: 4 });
  mapStore.ajouterElement(idCarte, { kind: 'porte', nom: 'Porte (ouverte)', x: 8, y: 4, w: 1, h: 1, blocksMovement: false, blocksVision: false });
  mapStore.ajouterElement(idCarte, { kind: 'porte', nom: 'Porte (ouverte)', x: 16, y: 4, w: 1, h: 1, blocksMovement: false, blocksVision: false });

  const elements = Object.values(mapStore.getMapById(idCarte).elements);
  const porteProche = elements.find(e => e.kind === 'porte' && e.x === 8).id;
  const porteLoin = elements.find(e => e.kind === 'porte' && e.x === 16).id;
  const unMur = elements.find(e => e.kind === 'mur').id;

  const JOUEUR = { role: 'player', playerId: 'char_porte' };
  const MJ = { role: 'mj' };
  const vues = () => mapStore.visionDuPersonnage(mapStore.getMapById(idCarte), 'char_porte').size;

  const ouverte = vues();
  assert(mapStore.basculerPorte(idCarte, porteProche, JOUEUR).success,
    'Un joueur doit pouvoir fermer une porte adjacente.');
  const fermee = vues();
  assert(fermee < ouverte,
    `Fermer la porte doit réduire le champ de vision (${ouverte} -> ${fermee}).`);
  assert(mapStore.basculerPorte(idCarte, porteProche, JOUEUR).success,
    'Un joueur doit pouvoir rouvrir la porte qu\'il vient de fermer.');
  assert(vues() === ouverte, 'Rouvrir doit rendre exactement la vision d\'origine.');

  // Distance : le joueur est en (7,4), la porte en (16,4).
  const loin = mapStore.basculerPorte(idCarte, porteLoin, JOUEUR);
  assert(!loin.success, 'Un joueur ne doit pas ouvrir une porte à distance.');
  assert(!mapStore.getMapById(idCarte).elements[porteLoin].blocksMovement,
    'Une porte refusée doit rester dans son état.');
  assert(mapStore.basculerPorte(idCarte, porteLoin, MJ).success,
    'Le MJ ouvre n\'importe quelle porte, de n\'importe où.');

  assert(!mapStore.basculerPorte(idCarte, unMur, JOUEUR).success,
    'Un élément qui n\'est pas une porte doit être refusé.');
  assert(!mapStore.basculerPorte(idCarte, unMur, MJ).success,
    'Même pour le MJ : un mur n\'est pas une porte.');

  // Verrou : le MJ garde son veto, que l'ouverture aux joueurs lui aurait
  // sinon retiré.
  mapStore.updateElement(idCarte, porteProche, { verrouillee: true });
  assert(!mapStore.basculerPorte(idCarte, porteProche, JOUEUR).success,
    'Une porte verrouillée doit résister au joueur.');
  assert(mapStore.basculerPorte(idCarte, porteProche, MJ).success,
    'Une porte verrouillée ne doit jamais résister au MJ.');

  // Un personnage absent de la carte est refusé AVANT que le verrou ne
  // soit évoqué : le message du verrou est une information de MJ, et ne
  // doit parvenir qu'à qui a la main sur la poignée.
  const absent = mapStore.basculerPorte(idCarte, porteProche, { role: 'player', playerId: 'char_absent' });
  assert(!absent.success, 'Un personnage absent de la carte doit être refusé.');
  assert(!/verrouill/i.test(absent.message),
    'Le refus d\'un joueur absent ne doit pas révéler que la porte est verrouillée.');

  // Non-exposition.
  const vueJoueur = JSON.stringify(mapStore.getMapForViewer(idCarte, {
    role: 'player', playerId: 'char_porte',
    entities: { players: [{ id: 'char_porte', nom: 'A', hp: { current: 1, max: 1 }, statuts: [] }], mobs: [] }
  }));
  assert(!vueJoueur.includes('verrouillee'),
    'verrouillee ne doit jamais être transmis au joueur : il l\'apprend en essayant.');
  assert(JSON.stringify(mapStore.getMapForViewer(idCarte, { role: 'mj', entities: { players: [], mobs: [] } }))
    .includes('verrouillee'),
    'Le MJ doit voir quelles portes il a verrouillées.');

  // Le champ est omis quand il est faux : le décor d'une carte générée
  // compte des centaines d'éléments qui n'ont rien d'une porte.
  assert(!('verrouillee' in mapStore.getMapById(idCarte).elements[porteLoin]),
    'verrouillee doit être omis quand il vaut faux.');

  mapStore.deleteMap(idCarte);

  const coeur = fs.readFileSync(path.join(__dirname, '..', 'website', 'map-core.js'), 'utf8');
  assert(coeur.includes('state.map.self ? state.map.tokens?.[state.map.self.tokenId]'),
    'L\'aura doit s\'ancrer sur le jeton du spectateur à défaut de sélection.');

  // V1.13.12b — Le centre de l'aura doit passer par px(), qui ajoute la
  // GOUTTIÈRE. Sans elle le cercle était décalé de 22 px sur chaque axe,
  // donc jamais centré sur le jeton — le défaut remonté par l'utilisateur.
  //
  // On reproduit ici les deux formules et on compare au centre calculé
  // par dessinerToken() : c'est la seule référence qui fasse foi.
  {
    const bloc = coeur.slice(coeur.indexOf('function dessinerAura'),
      coeur.indexOf('function dessinerMesure'));
    assert(/const cx = px\(token\.x \+ taille \/ 2\)/.test(bloc)
      && /const cy = px\(token\.y \+ taille \/ 2\)/.test(bloc),
      'Le centre de l\'aura doit être calculé avec px(), comme tout le reste du rendu.');
    assert(!/=\s*\([^)]*token\.[xy][^)]*\)\s*\*\s*g\.cellSize/.test(bloc),
      'Aucune coordonnée de case ne doit être convertie sans px() : la gouttière serait perdue.');

    const gouttiere = Number(/GUTTER\s*=\s*(\d+)/.exec(coeur)[1]);
    const cellSize = 40;
    const px = c => gouttiere + c * cellSize;
    const t = { x: 7, y: 4, size: 1 };
    const centreJeton = {
      x: px(t.x) + (t.size * cellSize) / 2,
      y: px(t.y) + (t.size * cellSize) / 2
    };
    const centreAura = { x: px(t.x + t.size / 2), y: px(t.y + t.size / 2) };
    assert(centreJeton.x === centreAura.x && centreJeton.y === centreAura.y,
      `L'aura doit être centrée sur le jeton (écart ${Math.hypot(
        centreJeton.x - centreAura.x, centreJeton.y - centreAura.y)} px).`);
  }

  console.log('PASS: V1.13.12 portes côté joueur — adjacence, verrou, non-exposition');
}
