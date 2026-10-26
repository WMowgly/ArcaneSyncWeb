// map.js
// ---------------------------------------------------------------------------
// ArcaneSync V1.13 — Bibliothèque de cartes de jeu (maps).
//
// Ce module gère UNIQUEMENT maps.json : la bibliothèque de cartes.
// Il ne connaît ni data.json (fiches) ni session.json (partie active).
//
// Séparation volontaire, cohérente avec le reste du projet :
//
//   data.json          -> fiches de personnage (persistant)
//   session.json       -> état de la partie active (+ activeMapId)
//   mob_templates.json -> bibliothèque de mobs
//   maps.json          -> bibliothèque de cartes            <-- ICI
//
// Une carte ne duplique JAMAIS une entité : un token référence un
// personnage (char_*) ou un mob de session (mob_*) par son ID stable.
// Les données d'affichage des entités sont injectées par server.js via
// le paramètre `entities`, ce qui évite toute dépendance circulaire.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { creerDepot, cheminDonnees } = require('./storage');

const cheminFichier = cheminDonnees('maps.json');

// ---------------------------------------------------------------------------
// Constantes de modèle
// ---------------------------------------------------------------------------

// Types d'éléments statiques posables sur la carte.
// blocksMovement / blocksVision sont les valeurs PAR DÉFAUT : le MJ peut
// toujours les surcharger élément par élément.
const KINDS_ELEMENT = Object.freeze({
  decor:    { id:'decor',    nom:'Décor',    icone:'🌳', blocksMovement:false, blocksVision:false, color:'#4f7a4a' },
  obstacle: { id:'obstacle', nom:'Obstacle', icone:'🪨', blocksMovement:true,  blocksVision:false, color:'#6b4b2f' },
  mur:      { id:'mur',      nom:'Mur',      icone:'🧱', blocksMovement:true,  blocksVision:true,  color:'#3b2f1e' },
  porte:    { id:'porte',    nom:'Porte',    icone:'🚪', blocksMovement:true,  blocksVision:true,  color:'#8b5e3c' },
  objet:    { id:'objet',    nom:'Objet',    icone:'📦', blocksMovement:false, blocksVision:false, color:'#b08948' },
  piege:    { id:'piege',    nom:'Piège',    icone:'⚠️', blocksMovement:false, blocksVision:false, color:'#9b2c2c' },
  marqueur: { id:'marqueur', nom:'Marqueur', icone:'📍', blocksMovement:false, blocksVision:false, color:'#3f6287' }
});

const MODES_BROUILLARD = Object.freeze(['none', 'vision', 'manual']);

const DEFAULT_GRID = Object.freeze({ cols: 24, rows: 16, cellSize: 48, showGrid: true });
const DEFAULT_BACKGROUND = Object.freeze({ color: '#fffdf7' });
const DEFAULT_VISION_RANGE = 6;

const MIN_COLS = 4,  MAX_COLS = 80;
const MIN_ROWS = 4,  MAX_ROWS = 80;
const MIN_CELL = 16, MAX_CELL = 160;
const MAX_MAPS = 60;

// Annotations : tracés libres et textes posés PAR-DESSUS la carte.
// Reprend le principe du tableau blanc V1.10, mais persisté et filtré.
const MAX_ANNOTATIONS = 400;
const MAX_POINTS_TRAIT = 600;
const MAX_LONGUEUR_TEXTE = 200;

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function entier(valeur, defaut, min, max) {
  const n = Math.round(Number(valeur));
  if (!Number.isFinite(n)) return defaut;
  return Math.max(min, Math.min(max, n));
}

function texte(valeur, defaut = '', maxLength = 2000) {
  if (typeof valeur !== 'string') return defaut;
  return valeur.slice(0, maxLength);
}

function couleur(valeur, defaut) {
  return /^#[0-9a-fA-F]{6}$/.test(valeur) ? valeur : defaut;
}

/** Comme entier(), mais conserve les décimales (coordonnées de tracé). */
function nombre(valeur, defaut, min, max) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return defaut;
  return Math.max(min, Math.min(max, n));
}

function cellKey(x, y) {
  return `${x},${y}`;
}

// ---------------------------------------------------------------------------
// Normalisation du modèle
// ---------------------------------------------------------------------------

function normaliserGrid(input = {}) {
  return {
    cols: entier(input.cols, DEFAULT_GRID.cols, MIN_COLS, MAX_COLS),
    rows: entier(input.rows, DEFAULT_GRID.rows, MIN_ROWS, MAX_ROWS),
    cellSize: entier(input.cellSize, DEFAULT_GRID.cellSize, MIN_CELL, MAX_CELL),
    showGrid: input.showGrid !== false
  };
}

function normaliserToken(input = {}, grid, options = {}) {
  const kind = input.kind === 'mob' ? 'mob' : 'player';
  const entityId = texte(input.entityId, '', 120);
  const id = options.id || input.id || `${kind}:${entityId || generateId('tok')}`;

  return {
    id,
    kind,
    entityId,
    x: entier(input.x, 0, 0, grid.cols - 1),
    y: entier(input.y, 0, 0, grid.rows - 1),
    size: entier(input.size, 1, 1, 6),
    // Un token invisible reste dans la carte côté MJ mais n'est JAMAIS
    // sérialisé dans la charge utile envoyée aux joueurs.
    visibleToPlayers: input.visibleToPlayers !== false,
    // Un token verrouillé ne peut être déplacé que par le MJ.
    locked: input.locked === true,
    vision: {
      range: entier(input.vision?.range, DEFAULT_VISION_RANGE, 0, 40)
    },
    color: couleur(input.color, kind === 'mob' ? '#7d3f3f' : '#3f6287'),
    label: texte(input.label, '', 60),
    // Réservé au MJ. Filtré par projectionJoueur().
    gmNotes: texte(input.gmNotes, '', 4000)
  };
}

function normaliserElement(input = {}, grid, options = {}) {
  const modele = KINDS_ELEMENT[input.kind] || KINDS_ELEMENT.decor;
  const x = entier(input.x, 0, 0, grid.cols - 1);
  const y = entier(input.y, 0, 0, grid.rows - 1);

  const portee = entier(input.lightRange, Number(modele.lightRange) || 0, 0, 40);

  return {
    id: options.id || input.id || generateId('elem'),
    kind: modele.id,
    nom: texte(input.nom, modele.nom, 80),
    x,
    y,
    w: entier(input.w, 1, 1, grid.cols - x),
    h: entier(input.h, 1, 1, grid.rows - y),
    color: couleur(input.color, modele.color),
    icone: texte(input.icone, modele.icone, 8),
    blocksMovement: typeof input.blocksMovement === 'boolean'
      ? input.blocksMovement : modele.blocksMovement,
    blocksVision: typeof input.blocksVision === 'boolean'
      ? input.blocksVision : modele.blocksVision,
    // V1.13.8 : portée d'éclairage en cases. 0 = pas une source de lumière.
    // JAMAIS transmis au joueur : connaître la position des sources hors de
    // sa vue renseignerait sur la carte, comme le ferait blocksVision.
    //
    // Le champ est OMIS quand il vaut 0. Une carte générée compte des
    // milliers d'éléments de décor dont une quinzaine éclairent : écrire
    // '"lightRange":0' partout ajoutait 75 Ko à maps.json pour ne rien dire.
    ...(portee > 0 ? { lightRange: portee } : {}),
    // V1.13.12 : une porte verrouillée résiste aux joueurs, jamais au MJ.
    // Omis quand il est faux, pour la même raison que lightRange : la très
    // grande majorité des éléments n'est pas concernée.
    //
    // JAMAIS transmis au joueur : savoir à l'avance qu'une porte résistera
    // est une information de MJ. Le joueur l'apprend en essayant.
    ...(input.verrouillee === true ? { verrouillee: true } : {}),
    visibleToPlayers: input.visibleToPlayers !== false,
    // Visible par les joueurs quand l'élément l'est.
    description: texte(input.description, '', 2000),
    // Réservé au MJ. Filtré par projectionJoueur().
    gmNotes: texte(input.gmNotes, '', 4000)
  };
}

function normaliserFog(input = {}, grid) {
  // V1.13.4 : le brouillard est ACTIF PAR DÉFAUT.
  //
  // `!== false` plutôt que `=== true` : une carte existante qui a
  // explicitement enregistré `enabled: false` conserve ce choix, tandis
  // qu'une carte neuve — ou une carte antérieure sans champ fog — démarre
  // protégée. Un joueur ne reçoit donc jamais la carte entière par simple
  // effet de bord de sa création.
  const mode = MODES_BROUILLARD.includes(input.mode) ? input.mode : 'vision';
  const revealed = Array.isArray(input.revealed) ? input.revealed : [];
  const cellulesValides = new Set();

  revealed.forEach(cle => {
    if (typeof cle !== 'string') return;
    const [sx, sy] = cle.split(',');
    const x = Number(sx);
    const y = Number(sy);
    if (!Number.isInteger(x) || !Number.isInteger(y)) return;
    if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) return;
    cellulesValides.add(cellKey(x, y));
  });

  return {
    enabled: input.enabled !== false,
    mode,
    // Mémoire d'exploration : les cases déjà vues restent connues du joueur.
    autoReveal: input.autoReveal !== false,
    revealed: [...cellulesValides]
  };
}

function normaliserDrawing(input = {}) {
  return {
    // Le MJ décide si la table peut annoter la carte.
    playersAllowed: input.playersAllowed === true
  };
}

/**
 * Annotation : tracé libre ou texte posé sur la carte.
 *
 * Les points sont exprimés en COORDONNÉES DE GRILLE fractionnaires
 * (x = 3.5 désigne le milieu de la colonne 3). Contrairement au tableau
 * blanc V1.10, qui raisonnait en pixels d'un canvas figé, une annotation
 * reste donc correctement placée si la taille de case change.
 */
function normaliserAnnotation(input = {}, grid, options = {}) {
  const type = input.type === 'texte' ? 'texte' : 'trait';
  const bruts = Array.isArray(input.points) ? input.points : [];

  const points = bruts
    .slice(0, type === 'texte' ? 1 : MAX_POINTS_TRAIT)
    .map(point => ({
      // Deux décimales suffisent et limitent la taille de maps.json.
      x: Math.round(nombre(point?.x, 0, 0, grid.cols) * 100) / 100,
      y: Math.round(nombre(point?.y, 0, 0, grid.rows) * 100) / 100
    }));

  const auteur = input.author === 'mj' ? 'mj' : texte(input.author, '', 120);

  return {
    id: options.id || input.id || generateId('note'),
    type,
    // 'mj' ou l'ID stable du personnage auteur.
    author: auteur || 'mj',
    visibleToPlayers: input.visibleToPlayers !== false,
    color: couleur(input.color, '#9b2c2c'),
    size: entier(input.size, 3, 1, 40),
    points,
    text: type === 'texte' ? texte(input.text, '', MAX_LONGUEUR_TEXTE) : '',
    createdAt: input.createdAt || new Date().toISOString()
  };
}

function annotationValide(annotation) {
  if (annotation.type === 'texte') {
    return annotation.points.length === 1 && annotation.text.trim().length > 0;
  }
  return annotation.points.length >= 2;
}

function normaliserMap(input = {}, options = {}) {
  const now = new Date().toISOString();
  const grid = normaliserGrid(input.grid);

  const tokens = {};
  Object.values(input.tokens || {}).forEach(token => {
    const normalise = normaliserToken(token, grid);
    if (!normalise.entityId) return;
    tokens[normalise.id] = normalise;
  });

  const elements = {};
  Object.values(input.elements || {}).forEach(element => {
    const normalise = normaliserElement(element, grid);
    elements[normalise.id] = normalise;
  });

  const annotations = {};
  Object.values(input.annotations || {}).forEach(annotation => {
    const normalise = normaliserAnnotation(annotation, grid);
    if (!annotationValide(normalise)) return;
    annotations[normalise.id] = normalise;
  });

  return {
    id: options.id || input.id || generateId('map'),
    nom: texte(input.nom, 'Nouvelle carte', 120) || 'Nouvelle carte',
    description: texte(input.description, '', 4000),
    // Type de lieu (forêt, caverne, ville…). Sert à proposer au MJ la
    // palette de décors adaptée. Chaîne libre côté modèle : c'est
    // mapgen.js qui détient le catalogue, map.js n'en dépend pas.
    type: texte(input.type, '', 40),
    grid,
    background: { color: couleur(input.background?.color, DEFAULT_BACKGROUND.color) },
    tokens,
    elements,
    annotations,
    drawing: normaliserDrawing(input.drawing),
    fog: normaliserFog(input.fog, grid),
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}

// ---------------------------------------------------------------------------
// Persistance atomique (même stratégie que joueur.js / session.js / mob.js)
// ---------------------------------------------------------------------------

let maps = {};

function lireMaps() {
  if (!fs.existsSync(cheminFichier)) {
    maps = {};
    return;
  }

  try {
    const donnees = JSON.parse(fs.readFileSync(cheminFichier, 'utf8'));
    const brutes = donnees && typeof donnees === 'object' && donnees.maps
      ? donnees.maps
      : donnees;

    maps = {};
    Object.values(brutes || {}).forEach(map => {
      if (!map || typeof map !== 'object') return;
      const normalisee = normaliserMap(map, { id: map.id });
      maps[normalisee.id] = normalisee;
    });
  } catch (error) {
    console.error('Erreur lors de la lecture de maps.json:', error);
    maps = {};
  }
}

const depotMaps = creerDepot(cheminFichier, {
  etiquette: 'maps.json',
  delaiMs: 250,
  // Prendre acte de NOS ecritures, pour ne pas les confondre avec une
  // modification externe au controle d obsolescence.
  apresEcriture: () => noterMtime()
});

/**
 * Persiste la bibliothèque.
 *
 * `options.differee` réserve le vidage disque aux chemins HAUTE FRÉQUENCE
 * (déplacement de token, révélation de brouillard, pose d'élément) : dix
 * cases traversées pendant un glisser ne produisent alors qu'une seule
 * écriture au lieu de dix. Les opérations structurelles — création,
 * suppression, régénération, import — restent immédiates.
 *
 * La mutation mémoire, elle, reste synchrone dans tous les cas.
 */
// ---------------------------------------------------------------------------
// GARDE-FOU D'OBSOLESCENCE
//
// Un effacement complet de maps.json a été observé sans avoir pu être
// reproduit. Le mécanisme, lui, est clair : un processus dont l'état
// mémoire ne reflète plus le fichier — module chargé pendant que le
// fichier était momentanément vide, par exemple dans la fenêtre de
// restauration d'un test — écrase au premier enregistrement tout ce
// qu'il ignore.
//
// On mémorise donc la date de modification du fichier au chargement, et
// on la rafraîchit après CHAQUE écriture que nous faisons nous-mêmes. Si
// elle a changé sans nous, quelqu'un d'autre a écrit : notre vue est
// périmée, et on refuse plutôt que de détruire.
//
// Le coût est un fs.statSync par écriture — quelques microsecondes, donc
// utilisable même sur le chemin haute fréquence.
// ---------------------------------------------------------------------------

let mtimeConnu = null;

function noterMtime() {
  try {
    mtimeConnu = fs.existsSync(cheminFichier) ? fs.statSync(cheminFichier).mtimeMs : null;
  } catch (erreur) {
    mtimeConnu = null;
  }
}

function fichierModifieAilleurs() {
  try {
    if (!fs.existsSync(cheminFichier)) return false;
    if (mtimeConnu === null) return false;   // rien à comparer
    return fs.statSync(cheminFichier).mtimeMs !== mtimeConnu;
  } catch (erreur) {
    return false;
  }
}

function ecrireMaps(nouvellesMaps, options = {}) {
  if (fichierModifieAilleurs()) {
    console.error(
      '[map] Écriture refusée : maps.json a été modifié par un autre processus '
      + 'depuis son chargement. La vue en mémoire est périmée et l\'écraserait. '
      + 'Rechargez le module ou redémarrez le serveur.'
    );
    return false;
  }

  const serialiser = () => JSON.stringify({ formatVersion: 1, maps: nouvellesMaps }, null, 2);

  // En différé, on transmet la FONCTION : la sérialisation du mégaoctet
  // n'a lieu qu'une fois, au vidage, et non à chaque mutation.
  return options.differee
    ? depotMaps.ecrireDifferee(serialiser)
    : depotMaps.ecrire(serialiser());
}

/** Force l'écriture en attente. Indispensable avant toute relecture disque. */
function flush() {
  return depotMaps.flush();
}

/**
 * Applique une mutation sur une carte et persiste le résultat.
 * En cas d'échec d'écriture, l'état mémoire n'est pas modifié : le disque
 * et la mémoire ne peuvent jamais diverger.
 */
function muterMap(mapId, mutation, options = {}) {
  const courante = maps[mapId];
  if (!courante) return { success: false, message: 'Carte introuvable.' };

  const brouillon = clone(courante);
  const resultat = mutation(brouillon);

  if (resultat && resultat.success === false) return resultat;

  brouillon.updatedAt = new Date().toISOString();
  const nouvellesMaps = { ...maps, [mapId]: brouillon };

  if (!ecrireMaps(nouvellesMaps, options)) {
    return { success: false, message: 'Impossible de sauvegarder la carte.' };
  }

  maps = nouvellesMaps;
  return { success: true, map: clone(maps[mapId]), ...(resultat || {}) };
}

// Chemins haute fréquence : le vidage disque est fusionné.
const DIFFEREE = Object.freeze({ differee: true });

// ---------------------------------------------------------------------------
// CRUD des cartes
// ---------------------------------------------------------------------------

function getMaps() {
  return Object.values(maps).map(map => ({
    id: map.id,
    nom: map.nom,
    description: map.description,
    grid: { ...map.grid },
    fog: { enabled: map.fog.enabled, mode: map.fog.mode },
    tokenCount: Object.keys(map.tokens).length,
    elementCount: Object.keys(map.elements).length,
    createdAt: map.createdAt,
    updatedAt: map.updatedAt
  }));
}

function getMapById(id) {
  return maps[id] ? clone(maps[id]) : null;
}

/**
 * Empreinte du CONTENU d'une carte : type, grille et décor.
 *
 * Volontairement indépendante du nom, de l'identifiant, des tokens et du
 * brouillard : deux générations avec la même graine produisent le même
 * décor, et c'est exactement le double-clic accidentel qu'on veut
 * détecter. Renommer une carte ne doit pas la rendre « différente ».
 */
function signatureCarte(map) {
  const decor = Object.values(map.elements || {})
    .map(e => `${e.x},${e.y},${e.w},${e.h},${e.kind},${e.nom}`)
    .sort()
    .join('|');

  const empreinte = JSON.stringify({
    type: map.type || '',
    grid: map.grid,
    background: map.background,
    decor
  });

  return crypto.createHash('sha1').update(empreinte).digest('hex');
}

function trouverCarteIdentique(map) {
  const signature = signatureCarte(map);
  return Object.values(maps).find(existante => signatureCarte(existante) === signature) || null;
}

/**
 * `options.force` contourne le contrôle de doublon. Réservé aux
 * intentions explicites (duplication demandée par le MJ).
 */
function createMap(donnees = {}, options = {}) {
  if (Object.keys(maps).length >= MAX_MAPS) {
    return { success: false, message: `Limite de ${MAX_MAPS} cartes atteinte.` };
  }

  const map = normaliserMap(donnees, { id: generateId('map') });

  if (options.force !== true) {
    const doublon = trouverCarteIdentique(map);
    if (doublon) {
      return {
        success: false,
        duplicate: true,
        existingMapId: doublon.id,
        message: `Une carte au contenu identique existe déjà : « ${doublon.nom} ». `
          + `Chargez-la, ou changez de graine pour obtenir une variante.`
      };
    }
  }

  const nouvellesMaps = { ...maps, [map.id]: map };

  if (!ecrireMaps(nouvellesMaps)) {
    return { success: false, message: 'Impossible de créer la carte.' };
  }

  maps = nouvellesMaps;
  return { success: true, map: clone(map) };
}

function updateMap(id, donnees = {}) {
  return muterMap(id, brouillon => {
    if (donnees.nom !== undefined) {
      brouillon.nom = texte(donnees.nom, brouillon.nom, 120) || brouillon.nom;
    }
    if (donnees.description !== undefined) {
      brouillon.description = texte(donnees.description, '', 4000);
    }
    if (donnees.type !== undefined) {
      brouillon.type = texte(donnees.type, '', 40);
    }
    if (donnees.background !== undefined) {
      brouillon.background = { color: couleur(donnees.background?.color, brouillon.background.color) };
    }

    if (donnees.grid !== undefined) {
      const grid = normaliserGrid({ ...brouillon.grid, ...donnees.grid });
      brouillon.grid = grid;

      // Redimensionner une carte ne doit jamais laisser un token ou un
      // élément hors des limites : on les repositionne sur le bord.
      Object.values(brouillon.tokens).forEach(token => {
        token.x = Math.min(token.x, grid.cols - 1);
        token.y = Math.min(token.y, grid.rows - 1);
      });
      Object.values(brouillon.elements).forEach(element => {
        element.x = Math.min(element.x, grid.cols - 1);
        element.y = Math.min(element.y, grid.rows - 1);
        element.w = Math.min(element.w, grid.cols - element.x);
        element.h = Math.min(element.h, grid.rows - element.y);
      });
      // Les annotations sont en coordonnées de grille : elles suivent le
      // redimensionnement, il suffit de les ramener dans les limites.
      Object.values(brouillon.annotations).forEach(annotation => {
        annotation.points = annotation.points.map(point => ({
          x: Math.min(point.x, grid.cols),
          y: Math.min(point.y, grid.rows)
        }));
      });

      brouillon.fog = normaliserFog(brouillon.fog, grid);
    }
  });
}

function deleteMap(id) {
  if (!maps[id]) return { success: false, message: 'Carte introuvable.' };

  const nouvellesMaps = { ...maps };
  delete nouvellesMaps[id];

  if (!ecrireMaps(nouvellesMaps)) {
    return { success: false, message: 'Impossible de supprimer la carte.' };
  }

  maps = nouvellesMaps;
  return { success: true };
}

/**
 * Duplique une carte : le décor, les obstacles et le brouillard sont
 * conservés, ce qui permet de réutiliser un donjon d'une partie à l'autre.
 */
function duplicateMap(id, nom) {
  const source = maps[id];
  if (!source) return { success: false, message: 'Carte introuvable.' };

  const copie = clone(source);
  delete copie.id;
  delete copie.createdAt;
  copie.nom = texte(nom, `${source.nom} (copie)`, 120) || `${source.nom} (copie)`;

  // Dupliquer, c'est justement vouloir un doublon : on court-circuite le
  // contrôle destiné aux créations accidentelles.
  return createMap(copie, { force: true });
}

// ---------------------------------------------------------------------------
// Tokens (entités mobiles)
// ---------------------------------------------------------------------------

function tokenIdPour(kind, entityId) {
  return `${kind}:${entityId}`;
}

function positionParDefaut(index, grid) {
  const colonnes = Math.max(1, Math.min(grid.cols - 2, 8));
  return {
    x: Math.min(grid.cols - 1, 1 + (index % colonnes)),
    y: Math.min(grid.rows - 1, 1 + Math.floor(index / colonnes))
  };
}

function casesOccupees(map) {
  const occupees = new Set();
  Object.values(map.tokens || {}).forEach(token => occupees.add(cellKey(token.x, token.y)));
  return occupees;
}

/**
 * Trouve une case praticable et libre.
 *
 * Les candidats sont essayés en premier : les générateurs fournissent des
 * points d'apparition groupés, pour que le groupe démarre ensemble plutôt
 * qu'éparpillé dans le décor.
 */
function trouverCaseLibre(map, occupees, candidats, bloquantes) {
  const murs = bloquantes || cellulesBloquantes(map, 'movement');

  for (const candidat of candidats || []) {
    const x = Math.round(Number(candidat?.x));
    const y = Math.round(Number(candidat?.y));
    if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
    if (x < 0 || y < 0 || x >= map.grid.cols || y >= map.grid.rows) continue;
    const cle = cellKey(x, y);
    if (!murs.has(cle) && !occupees.has(cle)) return { x, y };
  }

  for (let y = 0; y < map.grid.rows; y += 1) {
    for (let x = 0; x < map.grid.cols; x += 1) {
      const cle = cellKey(x, y);
      if (!murs.has(cle) && !occupees.has(cle)) return { x, y };
    }
  }

  // Carte entièrement obstruée : on place quand même le token, le MJ
  // reste libre de le déplacer.
  return { x: 0, y: 0 };
}

/**
 * Remplace intégralement le décor d'une carte (génération / régénération).
 *
 * Les tokens sont CONSERVÉS : seule leur position est corrigée s'ils se
 * retrouvent dans un obstacle. La mémoire d'exploration est effacée, car
 * elle décrivait un décor qui n'existe plus.
 */
function remplacerDecor(mapId, donnees = {}) {
  return muterMap(mapId, brouillon => {
    if (donnees.type !== undefined) {
      // Le type de lieu suit le décor : la palette du MJ s'adapte
      // automatiquement après une régénération.
      brouillon.type = texte(donnees.type, '', 40);
    }
    if (donnees.grid) {
      brouillon.grid = normaliserGrid({ ...brouillon.grid, ...donnees.grid });
    }

    if (donnees.background) {
      brouillon.background = {
        color: couleur(donnees.background.color, brouillon.background.color)
      };
    }

    const source = Array.isArray(donnees.elements)
      ? donnees.elements
      : Object.values(donnees.elements || {});

    const elements = {};
    source.forEach(element => {
      const normalise = normaliserElement(element, brouillon.grid, { id: generateId('elem') });
      elements[normalise.id] = normalise;
    });
    brouillon.elements = elements;

    // Le décor a changé : les zones explorées ne veulent plus rien dire.
    brouillon.fog = normaliserFog({ ...brouillon.fog, revealed: [] }, brouillon.grid);

    // Les annotations sont du contenu écrit par le MJ : on ne les efface
    // jamais dans son dos, on se contente de les ramener dans la grille.
    // Le bouton « Effacer les annotations » reste à sa main.
    Object.values(brouillon.annotations).forEach(annotation => {
      annotation.points = annotation.points.map(point => ({
        x: Math.min(point.x, brouillon.grid.cols),
        y: Math.min(point.y, brouillon.grid.rows)
      }));
    });

    const bloquantes = cellulesBloquantes(brouillon, 'movement');
    const occupees = new Set();
    const candidats = Array.isArray(donnees.spawn) ? donnees.spawn : [];

    Object.values(brouillon.tokens).forEach(token => {
      token.x = Math.min(Math.max(0, token.x), brouillon.grid.cols - 1);
      token.y = Math.min(Math.max(0, token.y), brouillon.grid.rows - 1);

      const cle = cellKey(token.x, token.y);
      if (!bloquantes.has(cle) && !occupees.has(cle)) {
        occupees.add(cle);
        return;
      }

      const libre = trouverCaseLibre(brouillon, occupees, candidats, bloquantes);
      token.x = libre.x;
      token.y = libre.y;
      occupees.add(cellKey(libre.x, libre.y));
    });

    return {
      elementCount: Object.keys(elements).length,
      generatedType: texte(donnees.type, '', 40) || undefined
    };
  });
}

/**
 * Cases candidates pour un placement automatique, ordonnées du plus
 * pertinent au moins pertinent.
 *
 * Poser une créature en 0,0 — premier résultat d'un balayage naïf — la
 * relègue dans un coin, souvent hors du champ de vision du groupe. On
 * vise donc le barycentre des personnages, là où se joue la scène, en
 * élargissant par anneaux successifs.
 */
function candidatsAutourDeLAction(map) {
  const personnages = Object.values(map.tokens || {}).filter(t => t.kind === 'player');

  const centre = personnages.length
    ? {
        x: Math.round(personnages.reduce((total, t) => total + t.x, 0) / personnages.length),
        y: Math.round(personnages.reduce((total, t) => total + t.y, 0) / personnages.length)
      }
    : { x: Math.floor(map.grid.cols / 2), y: Math.floor(map.grid.rows / 2) };

  const candidats = [];
  const portee = Math.max(map.grid.cols, map.grid.rows);

  for (let rayon = 1; rayon <= portee; rayon += 1) {
    for (let dx = -rayon; dx <= rayon; dx += 1) {
      for (let dy = -rayon; dy <= rayon; dy += 1) {
        // Seulement le pourtour de l'anneau : l'intérieur a déjà été vu.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rayon) continue;
        const x = centre.x + dx;
        const y = centre.y + dy;
        if (x < 0 || y < 0 || x >= map.grid.cols || y >= map.grid.rows) continue;
        candidats.push({ x, y });
      }
    }
  }

  return [centre, ...candidats];
}

function placerToken(mapId, donnees = {}) {
  return muterMap(mapId, brouillon => {
    const kind = donnees.kind === 'mob' ? 'mob' : 'player';
    const entityId = texte(donnees.entityId, '', 120);
    if (!entityId) return { success: false, message: "L'entité à placer est requise." };

    const id = tokenIdPour(kind, entityId);
    const existant = brouillon.tokens[id];

    // Sans coordonnées fournies, on cherche une case praticable et libre
    // plutôt que de retomber sur 0,0 — qui est un mur sur la plupart des
    // cartes générées. Le MJ peut ainsi placer une créature en un clic.
    let position = { x: donnees.x, y: donnees.y };
    if (!existant && donnees.x === undefined && donnees.y === undefined) {
      position = trouverCaseLibre(
        brouillon,
        casesOccupees(brouillon),
        candidatsAutourDeLAction(brouillon)
      );
    }

    brouillon.tokens[id] = normaliserToken(
      { ...(existant || {}), ...donnees, ...position, kind, entityId },
      brouillon.grid,
      { id }
    );

    return { tokenId: id, x: brouillon.tokens[id].x, y: brouillon.tokens[id].y };
  });
}

function updateToken(mapId, tokenId, donnees = {}) {
  return muterMap(mapId, brouillon => {
    const token = brouillon.tokens[tokenId];
    if (!token) return { success: false, message: 'Token introuvable sur la carte.' };

    brouillon.tokens[tokenId] = normaliserToken(
      { ...token, ...donnees, kind: token.kind, entityId: token.entityId },
      brouillon.grid,
      { id: tokenId }
    );

    return { tokenId };
  });
}

function retirerToken(mapId, tokenId) {
  return muterMap(mapId, brouillon => {
    if (!brouillon.tokens[tokenId]) {
      return { success: false, message: 'Token introuvable sur la carte.' };
    }
    delete brouillon.tokens[tokenId];
    return { tokenId };
  });
}

/**
 * Déplacement autoritaire d'un token.
 *
 * C'est le SERVEUR qui décide : le client propose une case, le serveur
 * valide les droits, les limites de la carte et les obstacles.
 * Même contrat que moveSceneToken() en V1.10, en coordonnées de grille.
 */
function deplacerToken(mapId, tokenId, x, y, contexte = {}) {
  const { role, playerId } = contexte;

  return muterMap(mapId, brouillon => {
    const token = brouillon.tokens[tokenId];
    if (!token) return { success: false, message: 'Token introuvable sur la carte.' };

    const estMj = role === 'mj';
    const estSonPersonnage = role === 'player'
      && token.kind === 'player'
      && token.entityId === playerId;

    if (!estMj && !estSonPersonnage) {
      return { success: false, message: 'Vous ne pouvez pas déplacer ce token.' };
    }

    if (!estMj && token.locked) {
      return { success: false, message: 'Ce token est verrouillé par le MJ.' };
    }

    const nx = Math.round(Number(x));
    const ny = Math.round(Number(y));

    if (!Number.isInteger(nx) || !Number.isInteger(ny)) {
      return { success: false, message: 'Position invalide.' };
    }

    if (nx < 0 || ny < 0 || nx >= brouillon.grid.cols || ny >= brouillon.grid.rows) {
      return { success: false, message: 'Position hors de la carte.' };
    }

    // Le MJ peut poser un token où il veut (y compris dans un mur) ;
    // les joueurs sont soumis aux obstacles.
    if (!estMj) {
      const bloquantes = cellulesBloquantes(brouillon, 'movement');
      for (let dx = 0; dx < token.size; dx += 1) {
        for (let dy = 0; dy < token.size; dy += 1) {
          if (bloquantes.has(cellKey(nx + dx, ny + dy))) {
            return { success: false, message: 'Cette case est obstruée.' };
          }
        }
      }
    }

    if (token.x === nx && token.y === ny) {
      return { success: false, message: 'Position inchangée.', unchanged: true };
    }

    token.x = nx;
    token.y = ny;

    return { tokenId, x: nx, y: ny };
  }, DIFFEREE);
}

/**
 * Synchronise la carte avec l'état de la partie :
 *  - place automatiquement les personnages absents ;
 *  - retire les tokens dont l'entité n'existe plus.
 *
 * Appelée avant chaque lecture de la carte active pour garantir que la
 * carte ne référence jamais une entité fantôme.
 */
function synchroniserTokens(mapId, entities = { players: [], mobs: [] }) {
  const map = maps[mapId];
  if (!map) return { success: false, message: 'Carte introuvable.' };

  const idsJoueurs = new Set((entities.players || []).map(e => e.id));
  const idsMobs = new Set((entities.mobs || []).map(e => e.id));

  let modifie = false;
  const brouillon = clone(map);

  Object.keys(brouillon.tokens).forEach(tokenId => {
    const token = brouillon.tokens[tokenId];
    const existe = token.kind === 'player'
      ? idsJoueurs.has(token.entityId)
      : idsMobs.has(token.entityId);
    if (!existe) {
      delete brouillon.tokens[tokenId];
      modifie = true;
    }
  });

  // Les personnages joueurs rejoignent automatiquement la carte active :
  // un joueur qui se connecte doit toujours avoir un token.
  // Les mobs, eux, sont placés explicitement par le MJ.
  const bloquantes = cellulesBloquantes(brouillon, 'movement');
  const occupees = casesOccupees(brouillon);
  let index = Object.keys(brouillon.tokens).length;

  (entities.players || []).forEach(joueur => {
    const id = tokenIdPour('player', joueur.id);
    if (brouillon.tokens[id]) return;

    // La position par défaut sert de préférence ; si elle tombe dans un
    // mur (fréquent sur une carte générée), on cherche une case libre.
    const pos = trouverCaseLibre(
      brouillon,
      occupees,
      [positionParDefaut(index, brouillon.grid)],
      bloquantes
    );

    brouillon.tokens[id] = normaliserToken(
      { kind: 'player', entityId: joueur.id, x: pos.x, y: pos.y },
      brouillon.grid,
      { id }
    );
    occupees.add(cellKey(pos.x, pos.y));
    index += 1;
    modifie = true;
  });

  if (!modifie) return { success: true, map: clone(map), modifie: false };

  brouillon.updatedAt = new Date().toISOString();
  const nouvellesMaps = { ...maps, [mapId]: brouillon };
  if (!ecrireMaps(nouvellesMaps)) {
    return { success: false, message: 'Impossible de synchroniser la carte.' };
  }

  maps = nouvellesMaps;
  return { success: true, map: clone(maps[mapId]), modifie: true };
}

// ---------------------------------------------------------------------------
// Éléments statiques (décor, obstacles, objets)
// ---------------------------------------------------------------------------

function ajouterElement(mapId, donnees = {}) {
  return muterMap(mapId, brouillon => {
    const element = normaliserElement(donnees, brouillon.grid, { id: generateId('elem') });
    brouillon.elements[element.id] = element;
    return { elementId: element.id };
  }, DIFFEREE);
}

/**
 * Pose PLUSIEURS elements en une seule mutation.
 *
 * La peinture au pinceau envoyait jusqu'ici une requete HTTP et une
 * mutation par case : tracer un mur de trente cases coutait trente
 * allers-retours et trente diffusions temps reel. Un seul appel suffit.
 */
function ajouterElements(mapId, liste = []) {
  if (!Array.isArray(liste) || !liste.length) {
    return { success: false, message: 'Aucun element a poser.' };
  }

  return muterMap(mapId, brouillon => {
    const ids = [];

    liste.forEach(donnees => {
      const element = normaliserElement(donnees, brouillon.grid, { id: generateId('elem') });
      brouillon.elements[element.id] = element;
      ids.push(element.id);
    });

    return { elementIds: ids };
  }, DIFFEREE);
}

function updateElement(mapId, elementId, donnees = {}) {
  return muterMap(mapId, brouillon => {
    const element = brouillon.elements[elementId];
    if (!element) return { success: false, message: 'Élément introuvable sur la carte.' };

    brouillon.elements[elementId] = normaliserElement(
      { ...element, ...donnees },
      brouillon.grid,
      { id: elementId }
    );

    return { elementId };
  });
}

/**
 * V1.13.12 — Ouvre ou ferme UNE porte, à la demande d'un joueur ou du MJ.
 *
 * Jusqu'ici seul le MJ ouvrait les portes, par une route gardée. Un joueur
 * arrivé devant une porte devait la lui demander, ce qui vidait la
 * fonctionnalité de son intérêt à la table.
 *
 * L'autorisation suit le modèle de deplacerToken() — la seule action de
 * joueur mutante existante : la décision est prise ICI, jamais côté client.
 *
 *   - le MJ ouvre n'importe quelle porte, de n'importe où ;
 *   - un joueur doit être ADJACENT (Chebyshev ≤ 1 entre une case de la
 *     porte et une case de son jeton). On ne vérifie pas la ligne de vue
 *     en plus : être à portée de bras suffit, et une porte adjacente est
 *     de toute façon visible ;
 *   - une porte VERROUILLÉE résiste aux joueurs, jamais au MJ.
 */
function basculerPorte(mapId, elementId, contexte = {}) {
  const { role, playerId } = contexte;
  const estMj = role === 'mj';

  return muterMap(mapId, brouillon => {
    const element = brouillon.elements[elementId];
    if (!element) return { success: false, message: 'Élément introuvable sur la carte.' };
    if (element.kind !== 'porte') {
      return { success: false, message: 'Cet élément n’est pas une porte.' };
    }

    if (!estMj) {
      const jeton = Object.values(brouillon.tokens).find(
        token => token.kind === 'player' && token.entityId === playerId
      );
      if (!jeton) {
        return { success: false, message: 'Votre personnage n’est pas sur cette carte.' };
      }

      // Chebyshev entre deux rectangles : l'écart sur chaque axe est nul
      // dès qu'ils se chevauchent, sinon c'est la distance entre bords.
      const taille = jeton.size || 1;
      const ecartX = Math.max(0, element.x - (jeton.x + taille - 1), jeton.x - (element.x + element.w - 1));
      const ecartY = Math.max(0, element.y - (jeton.y + taille - 1), jeton.y - (element.y + element.h - 1));

      if (Math.max(ecartX, ecartY) > 1) {
        return { success: false, message: 'Vous êtes trop loin de cette porte.' };
      }

      // Le verrou est vérifié EN DERNIER, et pas par hasard : le message
      // révèle une information de MJ. Il ne doit parvenir qu'à quelqu'un
      // qui a réellement la main sur la poignée, jamais à un joueur qui
      // sonderait la carte à distance.
      if (element.verrouillee) {
        return { success: false, message: 'Cette porte est verrouillée.' };
      }
    }

    const ouverte = !element.blocksMovement;
    element.blocksMovement = ouverte;
    element.blocksVision = ouverte;
    element.nom = ouverte ? 'Porte (fermée)' : 'Porte (ouverte)';

    return { elementId, ouverte: !ouverte };
  });
}

/**
 * V1.13.11 — Ouvre ou ferme TOUTES les portes d'une carte.
 *
 * Une carte générée compte une vingtaine de portes, toutes ouvertes. Les
 * fermer une à une avant une exploration rendait la fonctionnalité
 * théorique : c'est cette commande d'ensemble qui la rend utilisable.
 *
 * Le mécanisme reste celui de la porte unitaire — basculer blocksMovement
 * et blocksVision — pour que le moteur de vision n'ait rien à connaître de
 * plus. Une porte fermée arrête le passage ET la ligne de vue.
 */
function basculerPortes(mapId, fermer) {
  return muterMap(mapId, brouillon => {
    let touchees = 0;

    Object.values(brouillon.elements).forEach(element => {
      if (element.kind !== 'porte') return;
      if (!!element.blocksMovement === !!fermer) return;   // déjà dans l'état voulu

      element.blocksMovement = !!fermer;
      element.blocksVision = !!fermer;
      element.nom = fermer ? 'Porte (fermée)' : 'Porte (ouverte)';
      touchees += 1;
    });

    if (!touchees) {
      return { success: false, message: 'Aucune porte à modifier sur cette carte.' };
    }
    return { touchees };
  });
}

function supprimerElement(mapId, elementId) {
  return muterMap(mapId, brouillon => {
    if (!brouillon.elements[elementId]) {
      return { success: false, message: 'Élément introuvable sur la carte.' };
    }
    delete brouillon.elements[elementId];
    return { elementId };
  });
}

// ---------------------------------------------------------------------------
// ANNOTATIONS — le tableau blanc, posé sur la carte
//
// Différences assumées avec le tableau blanc V1.10 :
//   1. les annotations sont PERSISTÉES avec la carte (donc resynchronisées
//      après une reconnexion, comme tout le reste depuis V1.12) ;
//   2. elles portent un auteur et un calque (partagé / MJ seulement) ;
//   3. elles sont découpées par le brouillard de guerre côté serveur.
// ---------------------------------------------------------------------------

function setDrawingConfig(mapId, donnees = {}) {
  return muterMap(mapId, brouillon => {
    brouillon.drawing = normaliserDrawing({ ...brouillon.drawing, ...donnees });
  });
}

/**
 * Ajoute une annotation.
 *
 * `contexte` porte le rôle et le joueur : un joueur ne peut annoter que
 * si le MJ l'a autorisé, et son tracé est toujours partagé avec la table
 * (il ne peut pas créer de calque secret).
 */
function ajouterAnnotation(mapId, donnees = {}, contexte = {}) {
  return muterMap(mapId, brouillon => {
    const estMj = contexte.role === 'mj';

    if (!estMj) {
      if (!brouillon.drawing.playersAllowed) {
        return { success: false, message: "Le MJ n'a pas autorisé les joueurs à annoter la carte." };
      }
      if (!contexte.playerId) {
        return { success: false, message: 'Personnage inconnu.' };
      }
    }

    if (Object.keys(brouillon.annotations).length >= MAX_ANNOTATIONS) {
      return {
        success: false,
        message: `Limite de ${MAX_ANNOTATIONS} annotations atteinte : effacez-en avant d'en ajouter.`
      };
    }

    const annotation = normaliserAnnotation({
      ...donnees,
      author: estMj ? 'mj' : contexte.playerId,
      // Un joueur ne peut pas cacher son tracé aux autres joueurs.
      visibleToPlayers: estMj ? donnees.visibleToPlayers !== false : true
    }, brouillon.grid, { id: generateId('note') });

    if (!annotationValide(annotation)) {
      return { success: false, message: 'Annotation vide ou invalide.' };
    }

    brouillon.annotations[annotation.id] = annotation;
    return { annotationId: annotation.id, annotation };
  }, DIFFEREE);
}

function supprimerAnnotation(mapId, annotationId, contexte = {}) {
  return muterMap(mapId, brouillon => {
    // Un tracé découpé par le brouillard est renvoyé au joueur sous un
    // identifiant dérivé : on revient à l'annotation d'origine.
    const idReel = String(annotationId || '').split('~')[0];
    const annotation = brouillon.annotations[idReel];
    if (!annotation) return { success: false, message: 'Annotation introuvable.' };

    if (contexte.role !== 'mj' && annotation.author !== contexte.playerId) {
      return { success: false, message: 'Vous ne pouvez effacer que vos propres annotations.' };
    }

    delete brouillon.annotations[idReel];
    return { annotationId: idReel };
  });
}

/**
 * Efface en masse.
 * scope : 'all' | 'mj' | 'players'. Un joueur ne peut effacer que les siennes.
 */
function viderAnnotations(mapId, scope = 'all', contexte = {}) {
  return muterMap(mapId, brouillon => {
    const estMj = contexte.role === 'mj';
    const restantes = {};

    Object.values(brouillon.annotations).forEach(annotation => {
      let aSupprimer;
      if (!estMj) aSupprimer = annotation.author === contexte.playerId;
      else if (scope === 'mj') aSupprimer = annotation.author === 'mj';
      else if (scope === 'players') aSupprimer = annotation.author !== 'mj';
      else aSupprimer = true;

      if (!aSupprimer) restantes[annotation.id] = annotation;
    });

    const retirees = Object.keys(brouillon.annotations).length - Object.keys(restantes).length;
    brouillon.annotations = restantes;
    return { retirees };
  });
}

/** Cases connues d'un joueur : visibles maintenant, ou déjà explorées. */
function casesConnuesJoueur(map, playerId) {
  if (!map.fog.enabled || map.fog.mode === 'none') return null;

  if (map.fog.mode === 'vision') {
    const visibles = visionDuPersonnage(map, playerId);
    if (map.fog.autoReveal) map.fog.revealed.forEach(cle => visibles.add(cle));
    return visibles;
  }

  return new Set(map.fog.revealed);
}

/**
 * Aperçu en direct d'un tracé en cours.
 *
 * Le segment n'est relayé à un joueur que si TOUS ses points sont dans
 * une zone qu'il connaît : sans cela, le simple fait de dessiner
 * révélerait la forme d'un couloir non exploré.
 */
function segmentAutorisePour(mapId, playerId, points) {
  const map = maps[mapId];
  if (!map) return false;

  const connues = casesConnuesJoueur(map, playerId);
  if (!connues) return true;

  return (Array.isArray(points) ? points : []).every(point => {
    const x = Math.floor(Number(point?.x));
    const y = Math.floor(Number(point?.y));
    return Number.isInteger(x) && Number.isInteger(y) && connues.has(cellKey(x, y));
  });
}

function nomAuteur(entities, auteur) {
  if (auteur === 'mj') return 'MJ';
  const joueur = (entities.players || []).find(p => p.id === auteur);
  return joueur ? joueur.nom : 'Joueur';
}

/**
 * Projection des annotations pour un joueur.
 *
 * Un tracé qui traverse une zone inconnue est DÉCOUPÉ : seuls les
 * fragments situés dans une zone connue sont transmis. Le joueur ne peut
 * donc pas déduire le tracé caché depuis la charge utile réseau.
 * L'auteur, lui, voit toujours ses propres annotations en entier.
 */
function annotationsPourJoueur(map, entities, playerId, connues) {
  const sorties = {};

  const autorise = point => {
    if (!connues) return true;
    return connues.has(cellKey(Math.floor(point.x), Math.floor(point.y)));
  };

  Object.values(map.annotations || {}).forEach(annotation => {
    const sienne = annotation.author === playerId;
    if (!sienne && annotation.visibleToPlayers === false) return;

    const base = {
      type: annotation.type,
      author: annotation.author,
      authorName: nomAuteur(entities, annotation.author),
      own: sienne,
      color: annotation.color,
      size: annotation.size,
      text: annotation.text
      // `visibleToPlayers` n'est jamais transmis au joueur.
    };

    if (sienne || !connues) {
      sorties[annotation.id] = { ...base, id: annotation.id, points: annotation.points };
      return;
    }

    if (annotation.type === 'texte') {
      if (autorise(annotation.points[0])) {
        sorties[annotation.id] = { ...base, id: annotation.id, points: annotation.points };
      }
      return;
    }

    let fragment = [];
    let index = 0;

    const clore = () => {
      if (fragment.length >= 2) {
        const id = `${annotation.id}~${index}`;
        sorties[id] = { ...base, id, points: fragment };
        index += 1;
      }
      fragment = [];
    };

    annotation.points.forEach(point => {
      if (autorise(point)) fragment.push(point);
      else clore();
    });
    clore();
  });

  return sorties;
}

// ---------------------------------------------------------------------------
// Vision et brouillard de guerre
// ---------------------------------------------------------------------------

/**
 * Ensemble des cases bloquant le déplacement ou la vision.
 * `usage` vaut 'movement' ou 'vision'.
 */
function cellulesBloquantes(map, usage) {
  const propriete = usage === 'vision' ? 'blocksVision' : 'blocksMovement';
  const bloquantes = new Set();

  Object.values(map.elements || {}).forEach(element => {
    if (!element[propriete]) return;
    for (let dx = 0; dx < element.w; dx += 1) {
      for (let dy = 0; dy < element.h; dy += 1) {
        bloquantes.add(cellKey(element.x + dx, element.y + dy));
      }
    }
  });

  return bloquantes;
}

/**
 * Ligne de vue par tracé de Bresenham.
 * L'origine et la cible ne bloquent pas : on voit donc le mur qui nous
 * fait face, mais pas ce qui se trouve derrière.
 */
function ligneDeVueDegagee(x0, y0, x1, y1, bloquantes) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;

  let err = dx - dy;
  let x = x0;
  let y = y0;

  // Borne de sécurité : une grille fait au plus MAX_COLS x MAX_ROWS cases.
  for (let etape = 0; etape < MAX_COLS + MAX_ROWS + 2; etape += 1) {
    if (x === x1 && y === y1) return true;

    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx)  { err += dx; y += sy; }

    if (x === x1 && y === y1) return true;
    if (bloquantes.has(cellKey(x, y))) return false;
  }

  return false;
}

/**
 * Calcule les cases actuellement visibles depuis un ensemble d'origines.
 * Chaque origine : { x, y, range }.
 *
 * Portée circulaire (distance euclidienne) + ligne de vue.
 * Point d'extension prévu pour l'éclairage et la vision nocturne : il
 * suffira d'ajouter des origines supplémentaires (sources de lumière).
 */
function calculerCellulesVisibles(map, origines) {
  const bloquantes = cellulesBloquantes(map, 'vision');
  const visibles = new Set();

  (origines || []).forEach(origine => {
    const range = Math.max(0, Number(origine.range) || 0);
    visibles.add(cellKey(origine.x, origine.y));

    for (let dx = -range; dx <= range; dx += 1) {
      for (let dy = -range; dy <= range; dy += 1) {
        const x = origine.x + dx;
        const y = origine.y + dy;
        if (x < 0 || y < 0 || x >= map.grid.cols || y >= map.grid.rows) continue;
        if (Math.hypot(dx, dy) > range + 0.001) continue;
        if (visibles.has(cellKey(x, y))) continue;
        if (ligneDeVueDegagee(origine.x, origine.y, x, y, bloquantes)) {
          visibles.add(cellKey(x, y));
        }
      }
    }
  });

  return visibles;
}

/**
 * Origines de vision d'un joueur : ses propres tokens.
 * Un joueur ne « voit » jamais par les yeux d'un autre personnage.
 */
function originesVisionJoueur(map, playerId) {
  return Object.values(map.tokens || {})
    .filter(token => token.kind === 'player' && token.entityId === playerId)
    .map(token => ({ x: token.x, y: token.y, range: token.vision?.range ?? DEFAULT_VISION_RANGE }));
}

// ---------------------------------------------------------------------------
// V1.13.8 — SOURCES DE LUMIÈRE
//
// Modèle : on voit DE PRÈS même dans le noir (vision naturelle du
// personnage, inchangée), et on voit DE LOIN ce qui est éclairé et dégagé.
// Un mur coupe les deux.
//
// PROPRIÉTÉ DE SÛRETÉ : tant qu'aucun élément ne porte de lumière, le
// résultat est rigoureusement identique au comportement antérieur. C'est
// ce qui garantit qu'aucune carte existante ne change de comportement.
// ---------------------------------------------------------------------------

// Au-delà, une source éclairée n'est plus utilement discernable.
const PORTEE_VUE_ECLAIREE = 30;

/** Éléments porteurs de lumière, convertis en origines de vision. */
function originesLumiere(map) {
  const origines = [];

  Object.values(map.elements || {}).forEach(element => {
    const portee = Number(element.lightRange) || 0;
    if (portee <= 0) return;

    // Une source large éclaire depuis chacune de ses cases : sinon un
    // brasier de 2x2 n'éclairerait que par son coin supérieur gauche.
    for (let dx = 0; dx < element.w; dx += 1) {
      for (let dy = 0; dy < element.h; dy += 1) {
        origines.push({ x: element.x + dx, y: element.y + dy, range: portee });
      }
    }
  });

  return origines;
}

/**
 * Vision effective d'un ensemble d'origines de personnage.
 *
 * Factorise les quatre sites d'appel qui dupliquaient ce calcul
 * (casesConnuesJoueur, rafraichirExploration, projectionMj, projectionJoueur).
 */
function visionEffective(map, originesPerso) {
  const propre = calculerCellulesVisibles(map, originesPerso);

  const lumieres = originesLumiere(map);
  if (!lumieres.length || !originesPerso.length) return propre;

  // Ce que les sources éclairent réellement, murs pris en compte.
  const eclairees = calculerCellulesVisibles(map, lumieres);

  // Ce que le personnage peut atteindre du regard, sans limite de portée
  // naturelle mais toujours soumis aux obstacles.
  const portee = calculerCellulesVisibles(
    map,
    originesPerso.map(o => ({ x: o.x, y: o.y, range: PORTEE_VUE_ECLAIREE }))
  );

  // Visible = ce qu'on voit de près, PLUS ce qui est éclairé ET dans notre
  // ligne de vue.
  const visibles = new Set(propre);
  eclairees.forEach(cle => { if (portee.has(cle)) visibles.add(cle); });
  return visibles;
}

/** Vision d'un personnage donné, lumières comprises. */
function visionDuPersonnage(map, playerId) {
  return visionEffective(map, originesVisionJoueur(map, playerId));
}

/** Vision cumulée du groupe : sert à l'exploration et à l'aperçu MJ. */
function visionDuGroupe(map) {
  const origines = Object.values(map.tokens || {})
    .filter(token => token.kind === 'player')
    .map(token => ({ x: token.x, y: token.y, range: token.vision?.range ?? DEFAULT_VISION_RANGE }));

  return visionEffective(map, origines);
}

function setFogConfig(mapId, donnees = {}) {
  return muterMap(mapId, brouillon => {
    brouillon.fog = normaliserFog({ ...brouillon.fog, ...donnees }, brouillon.grid);
  });
}

/**
 * Révélation / masquage manuel de cases par le MJ (mode 'manual', mais
 * aussi utilisable comme mémoire d'exploration en mode 'vision').
 */
function revelerCellules(mapId, cellules, revele = true) {
  return muterMap(mapId, brouillon => {
    if (!Array.isArray(cellules)) {
      return { success: false, message: 'Liste de cases invalide.' };
    }

    const set = new Set(brouillon.fog.revealed);

    cellules.forEach(cellule => {
      const x = Math.round(Number(cellule?.x));
      const y = Math.round(Number(cellule?.y));
      if (!Number.isInteger(x) || !Number.isInteger(y)) return;
      if (x < 0 || y < 0 || x >= brouillon.grid.cols || y >= brouillon.grid.rows) return;
      if (revele) set.add(cellKey(x, y));
      else set.delete(cellKey(x, y));
    });

    brouillon.fog.revealed = [...set];
    return { revealedCount: brouillon.fog.revealed.length };
  }, DIFFEREE);
}

function resetFog(mapId) {
  return muterMap(mapId, brouillon => {
    brouillon.fog.revealed = [];
  });
}

/**
 * Mémoire d'exploration : ce que les personnages voient devient
 * définitivement « exploré ». Appelée après chaque déplacement.
 */
function rafraichirExploration(mapId) {
  const map = maps[mapId];
  if (!map) return { success: false, message: 'Carte introuvable.' };
  if (!map.fog.enabled || map.fog.mode !== 'vision' || !map.fog.autoReveal) {
    return { success: true, modifie: false };
  }

  const aDesPersonnages = Object.values(map.tokens).some(token => token.kind === 'player');
  if (!aDesPersonnages) return { success: true, modifie: false };

  const visibles = visionDuGroupe(map);
  const connues = new Set(map.fog.revealed);
  let modifie = false;

  visibles.forEach(cle => {
    if (!connues.has(cle)) {
      connues.add(cle);
      modifie = true;
    }
  });

  if (!modifie) return { success: true, modifie: false };

  const brouillon = clone(map);
  brouillon.fog.revealed = [...connues];
  brouillon.updatedAt = new Date().toISOString();

  const nouvellesMaps = { ...maps, [mapId]: brouillon };
  // Appelée après chaque déplacement : chemin haute fréquence.
  if (!ecrireMaps(nouvellesMaps, DIFFEREE)) {
    return { success: false, message: "Impossible de sauvegarder l'exploration." };
  }

  maps = nouvellesMaps;
  return { success: true, modifie: true };
}

// ---------------------------------------------------------------------------
// PROJECTIONS PAR RÔLE
//
// C'est le coeur de la sécurité du système : la charge utile envoyée à un
// joueur est CONSTRUITE à partir de ce qu'il a le droit de voir. Les
// informations MJ ne sont pas « masquées à l'affichage », elles n'existent
// pas dans l'objet sérialisé.
// ---------------------------------------------------------------------------

function entiteAffichable(entities, token, pourMj) {
  const source = token.kind === 'player'
    ? (entities.players || []).find(e => e.id === token.entityId)
    : (entities.mobs || []).find(e => e.id === token.entityId);

  if (!source) return null;

  const base = {
    id: source.id,
    nom: source.nom || (token.kind === 'mob' ? 'Créature' : 'Personnage'),
    hp: source.hp || { current: 0, max: 0 }
  };

  if (token.kind === 'player') {
    base.statuts = source.statuts || [];
  } else {
    base.statut = source.statut || 'vivant';
    // Les conditions d'une créature VISIBLE sont transmises au joueur,
    // comme le sont déjà celles des personnages. Une créature masquée
    // n'est de toute façon jamais sérialisée.
    base.statuts = source.statuts || [];
  }

  // Fiche détaillée et notes du mob : MJ uniquement.
  if (pourMj) {
    base.mana = source.mana || { current: 0, max: 0 };
    base.description = source.description || '';
    base.notes = source.notes || '';
  }

  return base;
}

function projectionMj(map, entities) {
  // Le MJ dispose d'un aperçu de ce que le groupe voit réellement :
  // c'est son outil de contrôle du brouillard de guerre.
  const visibles = map.fog.enabled && map.fog.mode === 'vision'
    ? visionDuGroupe(map)
    : new Set();

  const tokens = {};
  Object.values(map.tokens).forEach(token => {
    tokens[token.id] = { ...token, entity: entiteAffichable(entities, token, true) };
  });

  const annotations = {};
  Object.values(map.annotations || {}).forEach(annotation => {
    annotations[annotation.id] = {
      ...annotation,
      authorName: nomAuteur(entities, annotation.author),
      own: annotation.author === 'mj'
    };
  });

  return {
    role: 'mj',
    id: map.id,
    nom: map.nom,
    description: map.description,
    type: map.type,
    grid: { ...map.grid },
    background: { ...map.background },
    tokens,
    elements: clone(map.elements),
    annotations,
    drawing: { ...map.drawing },
    fog: {
      enabled: map.fog.enabled,
      mode: map.fog.mode,
      autoReveal: map.fog.autoReveal,
      revealed: [...map.fog.revealed]
    },
    playerVision: {
      visible: [...visibles],
      explored: [...map.fog.revealed]
    },
    updatedAt: map.updatedAt
  };
}

function projectionJoueur(map, entities, playerId) {
  const fogActif = map.fog.enabled && map.fog.mode !== 'none';

  let visibles = null;   // null = aucune restriction spatiale
  let explorees = [];

  if (fogActif) {
    if (map.fog.mode === 'vision') {
      visibles = visionDuPersonnage(map, playerId);
      explorees = map.fog.autoReveal ? [...map.fog.revealed] : [];
    } else {
      // Mode manuel : le MJ peint lui-même les zones connues du groupe.
      visibles = new Set(map.fog.revealed);
      explorees = [...map.fog.revealed];
    }
  }

  const setExplorees = new Set(explorees);

  const estVisible = (x, y, w = 1, h = 1) => {
    if (!visibles) return true;
    for (let dx = 0; dx < w; dx += 1) {
      for (let dy = 0; dy < h; dy += 1) {
        if (visibles.has(cellKey(x + dx, y + dy))) return true;
      }
    }
    return false;
  };

  const estExploree = (x, y, w = 1, h = 1) => {
    if (!visibles) return true;
    for (let dx = 0; dx < w; dx += 1) {
      for (let dy = 0; dy < h; dy += 1) {
        if (setExplorees.has(cellKey(x + dx, y + dy))) return true;
      }
    }
    return false;
  };

  // --- Tokens ---------------------------------------------------------
  // Un token n'est transmis que si :
  //   1. le MJ ne l'a pas masqué ;
  //   2. il occupe une case ACTUELLEMENT visible.
  // Une case seulement « explorée » ne révèle jamais les entités : se
  // souvenir d'une pièce n'apprend pas qui s'y trouve maintenant.
  const tokens = {};
  Object.values(map.tokens).forEach(token => {
    const sien = token.kind === 'player' && token.entityId === playerId;

    if (!sien) {
      if (token.visibleToPlayers === false) return;
      if (!estVisible(token.x, token.y, token.size, token.size)) return;
    }

    tokens[token.id] = {
      id: token.id,
      kind: token.kind,
      entityId: token.entityId,
      x: token.x,
      y: token.y,
      size: token.size,
      color: token.color,
      label: token.label,
      locked: token.locked,
      own: sien,
      entity: entiteAffichable(entities, token, false)
      // `vision` et `gmNotes` ne sont volontairement pas transmis.
    };
  });

  // --- Éléments -------------------------------------------------------
  // Le décor est statique : une fois exploré, il reste connu du joueur.
  const elements = {};
  Object.values(map.elements).forEach(element => {
    if (element.visibleToPlayers === false) return;
    const vu = estVisible(element.x, element.y, element.w, element.h);
    const connu = vu || estExploree(element.x, element.y, element.w, element.h);
    if (!connu) return;

    elements[element.id] = {
      id: element.id,
      kind: element.kind,
      nom: element.nom,
      x: element.x,
      y: element.y,
      w: element.w,
      h: element.h,
      color: element.color,
      icone: element.icone,
      blocksMovement: element.blocksMovement,
      description: element.description,
      remembered: !vu
      // `blocksVision` et `gmNotes` ne sont volontairement pas transmis.
    };
  });

  const monToken = Object.values(map.tokens)
    .find(token => token.kind === 'player' && token.entityId === playerId);

  // Zones connues = visibles maintenant + déjà explorées.
  // Les annotations suivent cette règle : une note posée dans un couloir
  // jamais exploré n'est pas transmise, même partiellement.
  const connues = visibles
    ? new Set([...visibles, ...setExplorees])
    : null;

  return {
    role: 'player',
    playerId: playerId || null,
    id: map.id,
    nom: map.nom,
    type: map.type,
    grid: { ...map.grid },
    background: { ...map.background },
    tokens,
    elements,
    annotations: annotationsPourJoueur(map, entities, playerId, connues),
    drawing: { ...map.drawing },
    fog: { enabled: fogActif, mode: fogActif ? map.fog.mode : 'none' },
    vision: {
      visible: visibles ? [...visibles] : null,
      explored: fogActif ? [...setExplorees] : null
    },
    self: monToken
      ? {
          tokenId: monToken.id,
          entityId: monToken.entityId,
          x: monToken.x,
          y: monToken.y,
          visionRange: monToken.vision?.range ?? DEFAULT_VISION_RANGE,
          locked: monToken.locked
        }
      : null,
    updatedAt: map.updatedAt
  };
}

/**
 * Point d'entrée UNIQUE de lecture d'une carte par un client.
 * Aucun autre chemin ne doit sérialiser une carte vers un client.
 */
function getMapForViewer(mapId, { role, playerId, entities } = {}) {
  const map = maps[mapId];
  if (!map) return null;

  const donnees = entities || { players: [], mobs: [] };
  return role === 'mj'
    ? projectionMj(map, donnees)
    : projectionJoueur(map, donnees, playerId || null);
}

lireMaps();
noterMtime();

module.exports = {
  KINDS_ELEMENT,
  MODES_BROUILLARD,
  DEFAULT_GRID,
  DEFAULT_VISION_RANGE,

  flush,
  signatureCarte,

  getMaps,
  getMapById,
  createMap,
  updateMap,
  deleteMap,
  duplicateMap,

  placerToken,
  updateToken,
  retirerToken,
  deplacerToken,
  synchroniserTokens,

  ajouterElement,
  ajouterElements,
  updateElement,
  supprimerElement,
  basculerPorte,
  basculerPortes,
  remplacerDecor,
  trouverCaseLibre,

  setDrawingConfig,
  ajouterAnnotation,
  supprimerAnnotation,
  viderAnnotations,
  segmentAutorisePour,
  casesConnuesJoueur,

  setFogConfig,
  revelerCellules,
  resetFog,
  rafraichirExploration,

  calculerCellulesVisibles,
  visionDuPersonnage,
  visionDuGroupe,
  originesLumiere,
  cellulesBloquantes,
  ligneDeVueDegagee,
  getMapForViewer,

  // Exportés pour les tests.
  normaliserMap,
  _lireMaps: lireMaps
};
