// mapgen.js
// ---------------------------------------------------------------------------
// ArcaneSync V1.13.4 — Générateurs de cartes et palettes de décor par biome.
//
// Ce module est PUR : il ne lit ni n'écrit aucun fichier et ne connaît ni
// la session ni les entités. Il produit une description de décor que
// map.js sait appliquer à une carte.
//
// Le résultat n'est en rien un format spécial : ce sont des `elements`
// ordinaires. Une carte générée reste donc entièrement modifiable avec
// les outils habituels du MJ.
//
// Deux rôles :
//   1. GÉNÉRER un environnement complet pour un type de lieu ;
//   2. FOURNIR la palette de décors cohérente avec ce type de lieu,
//      pour que le MJ pose ensuite « des arbres » dans une forêt et
//      « des tonneaux » dans une taverne, pas sept types génériques.
//
// La génération est DÉTERMINISTE : à graine identique, carte identique.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Générateur pseudo-aléatoire à graine (mulberry32)
// ---------------------------------------------------------------------------

function hachageGraine(valeur) {
  const texte = String(valeur ?? '');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < texte.length; i += 1) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function creerRng(graine) {
  let a = hachageGraine(graine) || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const entre = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
const choix = (rng, tableau) => tableau[Math.floor(rng() * tableau.length)];

/**
 * Bruit de valeur lissé, interpolé sur une grille grossière.
 *
 * C'est le remède principal à l'effet « poivre et sel » : au lieu de
 * tirer chaque case indépendamment, la densité varie DOUCEMENT dans
 * l'espace. On obtient des bosquets, des clairières et des zones
 * dégagées au lieu d'une pluie uniforme d'objets.
 */
function creerBruit(rng, cols, rows, echelle) {
  const nc = Math.ceil(cols / echelle) + 2;
  const nr = Math.ceil(rows / echelle) + 2;
  const treillis = new Float64Array(nc * nr);
  for (let i = 0; i < treillis.length; i += 1) treillis[i] = rng();

  const adoucir = t => t * t * (3 - 2 * t);
  const valeur = (cx, cy) =>
    treillis[Math.min(nr - 1, Math.max(0, cy)) * nc + Math.min(nc - 1, Math.max(0, cx))];

  return (x, y) => {
    const fx = x / echelle;
    const fy = y / echelle;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = adoucir(fx - x0);
    const ty = adoucir(fy - y0);
    const a = valeur(x0, y0);
    const b = valeur(x0 + 1, y0);
    const c = valeur(x0, y0 + 1);
    const d = valeur(x0 + 1, y0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

/** Deux octaves : grandes masses + détail. */
function creerBruitFractal(rng, cols, rows, echelle) {
  const grand = creerBruit(rng, cols, rows, echelle);
  const fin = creerBruit(rng, cols, rows, Math.max(2, Math.round(echelle / 2.5)));
  return (x, y) => grand(x, y) * 0.68 + fin(x, y) * 0.32;
}

// ---------------------------------------------------------------------------
// CATÉGORIES ET MATÉRIAUX
//
// Un matériau est un « pinceau » : un descripteur d'élément prêt à poser.
// Il se traduit en un `element` standard de map.js — aucun type nouveau
// n'est introduit côté modèle, la palette est une couche d'ergonomie.
// ---------------------------------------------------------------------------

const CATEGORIES = Object.freeze({
  vegetation:   { id: 'vegetation',   nom: 'Végétation' },
  roche:        { id: 'roche',        nom: 'Roche et relief' },
  eau:          { id: 'eau',          nom: 'Eau' },
  construction: { id: 'construction', nom: 'Construction' },
  mobilier:     { id: 'mobilier',     nom: 'Mobilier et objets' },
  sol:          { id: 'sol',          nom: 'Sol et chemins' },
  marqueur:     { id: 'marqueur',     nom: 'Repères et pièges' }
});

function mat(id, categorie, nom, kind, icone, color, blocksMovement, blocksVision, description) {
  return Object.freeze({
    id, categorie, nom, kind, icone, color,
    blocksMovement, blocksVision,
    description: description || ''
  });
}

const MATERIAUX = Object.freeze({
  // --- Végétation ---------------------------------------------------
  arbre:        mat('arbre','vegetation','Arbre','decor','🌲','#3f6b3a',true,true),
  arbreMort:    mat('arbreMort','vegetation','Arbre mort','decor','🥀','#6b5a3f',true,true),
  palmier:      mat('palmier','vegetation','Palmier','decor','🌴','#4f7a4a',true,true),
  buisson:      mat('buisson','vegetation','Buisson','decor','🌿','#6f9350',false,true),
  fougere:      mat('fougere','vegetation','Fougère','decor','','#5d8248',false,false),
  herbes:       mat('herbes','vegetation','Hautes herbes','decor','','#9aa85c',false,true),
  fleurs:       mat('fleurs','vegetation','Fleurs','decor','','#a8a05c',false,false),
  champignon:   mat('champignon','vegetation','Champignons','decor','🍄','#8d6f7a',false,false),
  lichen:       mat('lichen','vegetation','Lichen luminescent','decor','','#5f8f86',false,false),
  souche:       mat('souche','vegetation','Souche','decor','','#7a5c3a',false,false),
  troncCouche:  mat('troncCouche','vegetation','Tronc couché','obstacle','','#6f5335',true,false),
  cactus:       mat('cactus','vegetation','Cactus','obstacle','🌵','#4f7d4d',true,false),
  broussaille:  mat('broussaille','vegetation','Broussaille sèche','decor','','#94804f',false,true),
  culture:      mat('culture','vegetation','Champ cultivé','decor','','#a89a55',false,false),
  jardin:       mat('jardin','vegetation','Jardin','decor','','#6f8f52',false,false),

  // --- Roche et relief ----------------------------------------------
  rocher:       mat('rocher','roche','Rocher','obstacle','','#7a7168',true,false),
  rocherMousse: mat('rocherMousse','roche','Rocher moussu','obstacle','','#6b7a60',true,false),
  bloc:         mat('bloc','roche','Bloc erratique','obstacle','','#6d6459',true,true),
  paroi:        mat('paroi','roche','Paroi rocheuse','mur','','#4a4038',true,true),
  stalagmite:   mat('stalagmite','roche','Stalagmite','obstacle','','#6a5f52',true,true),
  cristal:      mat('cristal','roche','Cristal','decor','💎','#6f7fa8',true,false),
  gravats:      mat('gravats','roche','Gravats','obstacle','','#9b9184',true,false),
  dune:         mat('dune','roche','Dune','decor','','#d3b57e',false,true),
  sableMou:     mat('sableMou','roche','Sable mou','decor','','#e0c894',false,false),
  ossements:    mat('ossements','roche','Ossements','decor','🦴','#c7bda6',false,false),

  // --- Eau ------------------------------------------------------------
  eau:          mat('eau','eau','Eau profonde','obstacle','','#4a7fa5',true,false),
  eauPeuProfonde: mat('eauPeuProfonde','eau','Gué','decor','','#79a6c2',false,false),
  flaque:       mat('flaque','eau','Flaque','decor','','#6f9fbf',false,false),
  lac:          mat('lac','eau','Lac souterrain','obstacle','','#3f6f8f',true,false),
  puits:        mat('puits','eau','Puits','obstacle','','#7d7a70',true,false),
  fontaine:     mat('fontaine','eau','Fontaine','decor','⛲','#7ba7c4',true,false),

  // --- Construction ---------------------------------------------------
  murPierre:    mat('murPierre','construction','Mur de pierre','mur','','#6b5d4b',true,true),
  murMaison:    mat('murMaison','construction','Mur de maison','mur','','#8a6f52',true,true),
  murRuine:     mat('murRuine','construction','Mur effondré','mur','','#8d8069',true,true),
  murSable:     mat('murSable','construction','Mur ensablé','mur','','#b9a077',true,true),
  pilier:       mat('pilier','construction','Pilier','obstacle','','#7d7160',true,false),
  colonne:      mat('colonne','construction','Colonne brisée','obstacle','','#a2957e',true,false),
  porte:        mat('porte','construction','Porte (ouverte)','porte','🚪','#a9793f',false,false),
  portail:      mat('portail','construction','Portail','porte','','#8a6a3a',false,false),
  escalier:     mat('escalier','construction','Escalier','decor','','#8a8070',false,false),
  pont:         mat('pont','construction','Pont','decor','','#8b6b45',false,false),
  muret:        mat('muret','construction','Muret','obstacle','','#8d8069',true,false),
  palissade:    mat('palissade','construction','Palissade','mur','','#7a5f3d',true,true),

  // --- Mobilier et objets ---------------------------------------------
  table:        mat('table','mobilier','Table','objet','','#8b6b45',true,false),
  chaise:       mat('chaise','mobilier','Chaise','objet','','#9a7a4e',false,false),
  tonneau:      mat('tonneau','mobilier','Tonneau','objet','','#9a7345',true,false),
  caisse:       mat('caisse','mobilier','Caisse','objet','','#a08050',true,false),
  coffre:       mat('coffre','mobilier','Coffre','objet','📦','#8b5e3c',false,false),
  etagere:      mat('etagere','mobilier','Étagère','objet','','#7b6038',true,true),
  lit:          mat('lit','mobilier','Lit','objet','','#96795a',true,false),
  ratelier:     mat('ratelier','mobilier','Râtelier d’armes','objet','','#7d6a4a',true,false),
  autel:        mat('autel','mobilier','Autel','marqueur','','#7d6f9b',true,false),
  brasero:      mat('brasero','mobilier','Brasero','marqueur','','#b5622c',true,false),
  torche:       mat('torche','mobilier','Torche murale','marqueur','','#c07a35',false,false),
  lampadaire:   mat('lampadaire','mobilier','Lampadaire','marqueur','','#b08948',true,false),
  etal:         mat('etal','mobilier','Étal de marché','objet','','#a8683f',true,false),
  charrette:    mat('charrette','mobilier','Charrette','objet','','#8a6a42',true,false),
  paille:       mat('paille','mobilier','Paille','decor','','#c2ab6a',false,false),
  feu:          mat('feu','mobilier','Feu de camp','marqueur','🔥','#b5622c',false,false),
  tente:        mat('tente','mobilier','Tente','obstacle','','#a4794b',true,true),

  // --- Sol et chemins --------------------------------------------------
  sentier:      mat('sentier','sol','Sentier','decor','','#c8ab7a',false,false),
  pave:         mat('pave','sol','Pavés','decor','','#b9ae99',false,false),
  route:        mat('route','sol','Route','decor','','#c0ac8c',false,false),
  plancher:     mat('plancher','sol','Plancher','decor','','#c9a978',false,false),
  tapis:        mat('tapis','sol','Tapis','decor','','#9b5f5c',false,false),

  // --- Repères et pièges ------------------------------------------------
  piege:        mat('piege','marqueur','Piège','piege','⚠️','#9b2c2c',false,false),
  marqueur:     mat('marqueur','marqueur','Marqueur','marqueur','📍','#3f6287',false,false),
  panneau:      mat('panneau','marqueur','Panneau','marqueur','','#8a7350',false,false),
  statue:       mat('statue','marqueur','Statue','obstacle','','#93897a',true,false)
});

/** Descripteur d'élément : uniquement les champs que map.js comprend. */

// V1.13.8 : portée d'éclairage des matériaux lumineux, en cases.
// Une carte générée s'éclaire ainsi d'elle-même.
// V1.13.8 — Portée d'éclairage par matériau, en cases.
//
// Le lichen y figure volontairement : il est nommé « Lichen luminescent »
// et c'est le SEUL matériau que le générateur de cavernes place réellement
// parmi ceux de sa palette qui pourraient éclairer. Sans lui, une caverne
// naissait entièrement noire — précisément le biome où l'éclairage compte.
// Sa portée reste faible (2) : il éclaire son recoin, pas la salle.
const PORTEES_LUMIERE = Object.freeze({
  torche: 5, brasero: 6, feu: 6, lampadaire: 5, cristal: 3, lichen: 2
});

function descripteurElement(materiau) {
  return {
    kind: materiau.kind,
    nom: materiau.nom,
    icone: materiau.icone,
    color: materiau.color,
    blocksMovement: materiau.blocksMovement,
    blocksVision: materiau.blocksVision,
    ...(PORTEES_LUMIERE[materiau.id] ? { lightRange: PORTEES_LUMIERE[materiau.id] } : {}),
    description: materiau.description
  };
}

const M = MATERIAUX;

// ---------------------------------------------------------------------------
// PALETTES PAR TYPE DE LIEU
//
// Le MJ ne doit pas se voir proposer un cactus dans un donjon. Chaque
// biome déclare la liste des matériaux qu'il propose ; une poignée de
// matériaux universels reste toujours disponible.
//
// Ajouter un biome = ajouter une entrée ici et un générateur plus bas.
// ---------------------------------------------------------------------------

const PALETTE_UNIVERSELLE = ['murPierre', 'porte', 'coffre', 'marqueur', 'piege', 'feu', 'torche'];

const PALETTES = Object.freeze({
  foret: ['arbre', 'arbreMort', 'buisson', 'fougere', 'herbes', 'fleurs', 'champignon',
          'souche', 'troncCouche', 'rocher', 'rocherMousse', 'bloc',
          'eau', 'eauPeuProfonde', 'flaque', 'pont', 'sentier', 'muret', 'tente', 'panneau'],

  caverne: ['paroi', 'stalagmite', 'cristal', 'rocher', 'bloc', 'gravats',
            'champignon', 'lichen', 'lac', 'flaque', 'pont',
            'pilier', 'escalier', 'ossements', 'brasero', 'statue'],

  batiment: ['murPierre', 'pilier', 'porte', 'portail', 'escalier', 'plancher', 'tapis',
             'table', 'chaise', 'tonneau', 'caisse', 'etagere', 'lit', 'ratelier',
             'autel', 'brasero', 'torche', 'paille', 'statue', 'gravats'],

  ruines: ['murRuine', 'colonne', 'gravats', 'pilier', 'escalier', 'statue',
           'buisson', 'herbes', 'arbre', 'arbreMort', 'lichen', 'rocherMousse',
           'flaque', 'autel', 'ossements', 'muret'],

  ville: ['murMaison', 'porte', 'portail', 'pave', 'route', 'muret', 'palissade',
          'etal', 'charrette', 'tonneau', 'caisse', 'table', 'chaise',
          'lampadaire', 'puits', 'fontaine', 'jardin', 'arbre', 'buisson', 'panneau'],

  plaine: ['herbes', 'fleurs', 'buisson', 'arbre', 'arbreMort', 'culture', 'jardin',
           'rocher', 'bloc', 'eau', 'eauPeuProfonde', 'pont', 'sentier',
           'muret', 'palissade', 'charrette', 'tente', 'feu', 'panneau'],

  desert: ['dune', 'sableMou', 'rocher', 'bloc', 'cactus', 'broussaille', 'ossements',
           'murSable', 'colonne', 'gravats', 'statue',
           'eau', 'palmier', 'flaque', 'tente', 'charrette', 'panneau']
});

/**
 * Palette proposée au MJ pour un type de lieu, groupée par catégorie.
 * Un type inconnu (carte dessinée à la main) reçoit une palette
 * générique : le MJ n'est jamais bloqué.
 */
function getPalette(typeId) {
  const ids = PALETTES[typeId]
    ? [...PALETTES[typeId], ...PALETTE_UNIVERSELLE.filter(id => !PALETTES[typeId].includes(id))]
    : Object.keys(MATERIAUX);

  const groupes = new Map();
  ids.forEach(id => {
    const materiau = MATERIAUX[id];
    if (!materiau) return;
    if (!groupes.has(materiau.categorie)) groupes.set(materiau.categorie, []);
    groupes.get(materiau.categorie).push({
      id: materiau.id,
      nom: materiau.nom,
      icone: materiau.icone,
      color: materiau.color,
      kind: materiau.kind,
      blocksMovement: materiau.blocksMovement,
      blocksVision: materiau.blocksVision
    });
  });

  return {
    type: PALETTES[typeId] ? typeId : '',
    groupes: Object.values(CATEGORIES)
      .filter(cat => groupes.has(cat.id))
      .map(cat => ({ id: cat.id, nom: cat.nom, elements: groupes.get(cat.id) }))
  };
}

/** Résolution d'un pinceau : le serveur ne fait jamais confiance au client. */
function getMateriau(id) {
  const materiau = MATERIAUX[id];
  return materiau ? descripteurElement(materiau) : null;
}

// ---------------------------------------------------------------------------
// Terrain de travail
// ---------------------------------------------------------------------------

function creerTerrain(cols, rows) {
  return { cols, rows, cases: new Array(cols * rows).fill(null) };
}

function lire(terrain, x, y) {
  if (x < 0 || y < 0 || x >= terrain.cols || y >= terrain.rows) return undefined;
  return terrain.cases[y * terrain.cols + x];
}

function poser(terrain, x, y, materiau) {
  if (x < 0 || y < 0 || x >= terrain.cols || y >= terrain.rows) return;
  terrain.cases[y * terrain.cols + x] = materiau;
}

/** Ne pose que si la case est libre : évite d'écraser le travail précédent. */
function poserSiLibre(terrain, x, y, materiau) {
  if (lire(terrain, x, y)) return;
  poser(terrain, x, y, materiau);
}

function poserRect(terrain, x, y, w, h, materiau) {
  for (let dx = 0; dx < w; dx += 1) {
    for (let dy = 0; dy < h; dy += 1) poser(terrain, x + dx, y + dy, materiau);
  }
}

function viderRect(terrain, x, y, w, h) {
  poserRect(terrain, x, y, w, h, null);
}

function viderDisque(terrain, cx, cy, rayon) {
  for (let x = cx - rayon; x <= cx + rayon; x += 1) {
    for (let y = cy - rayon; y <= cy + rayon; y += 1) {
      if (Math.hypot(x - cx, y - cy) <= rayon) poser(terrain, x, y, null);
    }
  }
}

function estPraticable(terrain, x, y) {
  const materiau = lire(terrain, x, y);
  if (materiau === undefined) return false;
  return !materiau || materiau.blocksMovement !== true;
}

/**
 * Garantit qu'une carte générée est jouable : une seule zone praticable
 * connexe. Les poches isolées sont comblées avec le matériau de remplissage.
 */
function garantirConnexite(terrain, materiauRemplissage) {
  const vus = new Array(terrain.cols * terrain.rows).fill(false);
  const composantes = [];

  for (let y = 0; y < terrain.rows; y += 1) {
    for (let x = 0; x < terrain.cols; x += 1) {
      const depart = y * terrain.cols + x;
      if (vus[depart] || !estPraticable(terrain, x, y)) continue;

      const composante = [];
      const pile = [[x, y]];
      vus[depart] = true;

      while (pile.length) {
        const [cx, cy] = pile.pop();
        composante.push({ x: cx, y: cy });

        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
          const nx = cx + dx;
          const ny = cy + dy;
          const index = ny * terrain.cols + nx;
          if (nx < 0 || ny < 0 || nx >= terrain.cols || ny >= terrain.rows) return;
          if (vus[index] || !estPraticable(terrain, nx, ny)) return;
          vus[index] = true;
          pile.push([nx, ny]);
        });
      }

      composantes.push(composante);
    }
  }

  if (!composantes.length) return [];

  composantes.sort((a, b) => b.length - a.length);
  const principale = composantes[0];

  composantes.slice(1).forEach(composante => {
    composante.forEach(cellule => poser(terrain, cellule.x, cellule.y, materiauRemplissage));
  });

  return principale;
}

function calculerApparitions(terrain, principale, rng, nombre = 24) {
  if (!principale.length) return [];

  const depart = choix(rng, principale);
  const vus = new Set([`${depart.x},${depart.y}`]);
  const file = [depart];
  const apparitions = [];

  while (file.length && apparitions.length < nombre) {
    const cellule = file.shift();
    apparitions.push(cellule);

    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
      const nx = cellule.x + dx;
      const ny = cellule.y + dy;
      const cle = `${nx},${ny}`;
      if (vus.has(cle) || !estPraticable(terrain, nx, ny)) return;
      vus.add(cle);
      file.push({ x: nx, y: ny });
    });
  }

  return apparitions;
}

// ---------------------------------------------------------------------------
// Compactage : fusionne les cases identiques adjacentes en rectangles.
// ---------------------------------------------------------------------------

function terrainVersElements(terrain) {
  const bandes = [];

  for (let y = 0; y < terrain.rows; y += 1) {
    let x = 0;
    while (x < terrain.cols) {
      const materiau = lire(terrain, x, y);
      if (!materiau) { x += 1; continue; }

      let fin = x;
      while (fin + 1 < terrain.cols && lire(terrain, fin + 1, y) === materiau) fin += 1;

      bandes.push({ x, y, w: fin - x + 1, materiau });
      x = fin + 1;
    }
  }

  const groupes = new Map();
  bandes.forEach(bande => {
    const cle = `${bande.x}|${bande.w}|${bande.materiau.id}`;
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(bande);
  });

  const elements = [];
  groupes.forEach(liste => {
    liste.sort((a, b) => a.y - b.y);
    let courant = null;

    liste.forEach(bande => {
      if (courant && bande.y === courant.y + courant.h) { courant.h += 1; return; }
      if (courant) elements.push(courant);
      courant = { ...descripteurElement(bande.materiau), x: bande.x, y: bande.y, w: bande.w, h: 1 };
    });

    if (courant) elements.push(courant);
  });

  return elements;
}

// ---------------------------------------------------------------------------
// Outils de tracé partagés
// ---------------------------------------------------------------------------

/** Cours d'eau serpentant, avec berges et un point de franchissement. */
function tracerCoursDeau(terrain, rng, options = {}) {
  const { cols, rows } = terrain;
  const vertical = options.vertical ?? rng() < 0.5;
  const eau = options.eau || M.eau;
  const gue = options.gue || M.eauPeuProfonde;
  const franchissement = options.pont || M.pont;

  const longueur = vertical ? rows : cols;
  const traverse = vertical ? cols : rows;
  let position = entre(rng, Math.floor(traverse * 0.25), Math.floor(traverse * 0.75));
  const passages = new Set([entre(rng, 2, longueur - 3), entre(rng, 2, longueur - 3)]);

  for (let i = 0; i < longueur; i += 1) {
    const largeur = 1 + (rng() < 0.45 ? 1 : 0);
    for (let d = 0; d < largeur; d += 1) {
      const p = position + d;
      const materiau = passages.has(i) ? franchissement : eau;
      if (vertical) poser(terrain, p, i, materiau);
      else poser(terrain, i, p, materiau);

      // Berge peu profonde : rend la rive lisible et franchissable.
      if (!passages.has(i) && rng() < 0.35) {
        if (vertical) poserSiLibre(terrain, p + (d ? 1 : -1), i, gue);
        else poserSiLibre(terrain, i, p + (d ? 1 : -1), gue);
      }
    }
    position = Math.max(1, Math.min(traverse - 3, position + entre(rng, -1, 1)));
  }
}

/** Chemin sinueux reliant deux points, en effaçant ce qu'il traverse. */
function tracerChemin(terrain, rng, depart, arrivee, materiau, largeur = 1) {
  let { x, y } = depart;
  let securite = (terrain.cols + terrain.rows) * 4;

  while ((x !== arrivee.x || y !== arrivee.y) && securite-- > 0) {
    for (let d = 0; d < largeur; d += 1) {
      poser(terrain, x, y + d, materiau);
    }

    const dx = Math.sign(arrivee.x - x);
    const dy = Math.sign(arrivee.y - y);

    // Une chance sur quatre de dévier : le chemin serpente au lieu
    // de dessiner une équerre parfaite.
    if (rng() < 0.25 && dy !== 0) y += dy;
    else if (dx !== 0 && (rng() < 0.7 || dy === 0)) x += dx;
    else if (dy !== 0) y += dy;
    else x += dx;
  }
}

// ---------------------------------------------------------------------------
// GÉNÉRATEURS
// ---------------------------------------------------------------------------

/** Forêt : bosquets modulés par le bruit, clairières, ruisseau, sentier. */
function genererForet(terrain, rng, densite) {
  const { cols, rows } = terrain;
  const bruitArbres = creerBruitFractal(rng, cols, rows, 7);
  const bruitSousBois = creerBruitFractal(rng, cols, rows, 4);

  // Le seuil dépend du bruit : les zones denses forment des bosquets,
  // les zones creuses restent naturellement ouvertes.
  const seuil = 0.58 - (densite - 1) * 0.14;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const n = bruitArbres(x, y);
      if (n > seuil + 0.14) poser(terrain, x, y, M.arbre);
      else if (n > seuil && rng() < 0.55) poser(terrain, x, y, rng() < 0.18 ? M.arbreMort : M.arbre);
    }
  }

  // Clairières : plusieurs poches ouvertes de tailles différentes.
  const clairieres = [];
  const nbClairieres = Math.max(2, Math.round(3 + Math.min(cols, rows) / 14));
  for (let i = 0; i < nbClairieres; i += 1) {
    const cx = entre(rng, 3, cols - 4);
    const cy = entre(rng, 3, rows - 4);
    const rayon = entre(rng, 2, 5);
    viderDisque(terrain, cx, cy, rayon);
    clairieres.push({ x: cx, y: cy, rayon });
  }

  // Ruisseau traversant.
  if (rng() < 0.8) tracerCoursDeau(terrain, rng, {});

  // Sentier reliant deux bords en passant par une clairière.
  const entree = { x: 0, y: entre(rng, 1, rows - 2) };
  const sortie = { x: cols - 1, y: entre(rng, 1, rows - 2) };
  const etape = clairieres.length ? choix(rng, clairieres) : sortie;
  tracerChemin(terrain, rng, entree, { x: etape.x, y: etape.y }, M.sentier, 2);
  tracerChemin(terrain, rng, { x: etape.x, y: etape.y }, sortie, M.sentier, 2);

  // Aménagement des clairières : un campement, un cercle de pierres.
  clairieres.forEach((clairiere, index) => {
    if (index === 0) {
      poser(terrain, clairiere.x, clairiere.y, M.feu);
      for (let i = 0; i < 2; i += 1) {
        poserSiLibre(terrain, clairiere.x + entre(rng, -2, 2), clairiere.y + entre(rng, -2, 2), M.tente);
      }
    } else if (rng() < 0.4) {
      const r = Math.max(1, clairiere.rayon - 1);
      for (let a = 0; a < 8; a += 1) {
        const angle = (a / 8) * Math.PI * 2;
        poserSiLibre(terrain,
          Math.round(clairiere.x + Math.cos(angle) * r),
          Math.round(clairiere.y + Math.sin(angle) * r), M.bloc);
      }
    }
  });

  // Sous-bois : densité modulée, donc regroupée par plaques.
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (lire(terrain, x, y)) continue;
      const n = bruitSousBois(x, y);
      const tirage = rng();
      if (n > 0.6 && tirage < 0.42 * densite) poser(terrain, x, y, M.buisson);
      else if (n > 0.5 && tirage < 0.30 * densite) poser(terrain, x, y, M.fougere);
      else if (n < 0.35 && tirage < 0.22 * densite) poser(terrain, x, y, M.herbes);
      else if (tirage < 0.05 * densite) poser(terrain, x, y, M.rocherMousse);
      else if (tirage < 0.075 * densite) poser(terrain, x, y, M.souche);
      else if (tirage < 0.09 * densite) poser(terrain, x, y, M.fleurs);
      else if (tirage < 0.10 * densite) poser(terrain, x, y, M.champignon);
      else if (tirage < 0.11 * densite) poser(terrain, x, y, M.troncCouche);
    }
  }

  return { remplissage: M.arbre, background: '#dbe7c9' };
}

/** Caverne : automate cellulaire, chambres forées, lac, concrétions. */
function genererCaverne(terrain, rng, densite) {
  const { cols, rows } = terrain;
  const murs = new Array(cols * rows);

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const bord = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
      murs[y * cols + x] = bord || rng() < 0.46;
    }
  }

  for (let passe = 0; passe < 5; passe += 1) {
    const copie = murs.slice();
    for (let y = 1; y < rows - 1; y += 1) {
      for (let x = 1; x < cols - 1; x += 1) {
        let voisins = 0;
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            if (!dx && !dy) continue;
            if (copie[(y + dy) * cols + (x + dx)]) voisins += 1;
          }
        }
        murs[y * cols + x] = voisins >= 5;
      }
    }
  }

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (murs[y * cols + x]) poser(terrain, x, y, M.paroi);
    }
  }

  // Chambres forées et reliées : évite le labyrinthe uniforme de bruit.
  const chambres = [];
  const nbChambres = Math.max(3, Math.round(Math.min(cols, rows) / 6));
  for (let i = 0; i < nbChambres; i += 1) {
    const cx = entre(rng, 4, cols - 5);
    const cy = entre(rng, 4, rows - 5);
    const rayon = entre(rng, 2, 5);
    viderDisque(terrain, cx, cy, rayon);
    chambres.push({ x: cx, y: cy, rayon });
  }
  for (let i = 1; i < chambres.length; i += 1) {
    tracerChemin(terrain, rng, chambres[i - 1], chambres[i], null, 2);
  }

  // Lac souterrain dans la plus vaste chambre.
  const grande = chambres.reduce((a, b) => (b.rayon > a.rayon ? b : a), chambres[0]);
  if (grande && grande.rayon >= 4) {
    for (let x = grande.x - grande.rayon; x <= grande.x + grande.rayon; x += 1) {
      for (let y = grande.y - grande.rayon; y <= grande.y + grande.rayon; y += 1) {
        const d = Math.hypot(x - grande.x, y - grande.y);
        if (d <= grande.rayon - 1) poser(terrain, x, y, M.lac);
        else if (d <= grande.rayon) poserSiLibre(terrain, x, y, M.flaque);
      }
    }
  }

  const bruitDetail = creerBruitFractal(rng, cols, rows, 5);
  for (let y = 1; y < rows - 1; y += 1) {
    for (let x = 1; x < cols - 1; x += 1) {
      if (lire(terrain, x, y)) continue;
      const n = bruitDetail(x, y);
      const tirage = rng();
      if (n > 0.62 && tirage < 0.20 * densite) poser(terrain, x, y, M.stalagmite);
      else if (n > 0.7 && tirage < 0.08 * densite) poser(terrain, x, y, M.cristal);
      else if (n < 0.34 && tirage < 0.14 * densite) poser(terrain, x, y, M.gravats);
      else if (tirage < 0.05 * densite) poser(terrain, x, y, M.champignon);
      else if (tirage < 0.075 * densite) poser(terrain, x, y, M.lichen);
      else if (tirage < 0.09 * densite) poser(terrain, x, y, M.rocher);
      else if (tirage < 0.10 * densite) poser(terrain, x, y, M.ossements);
    }
  }

  return { remplissage: M.paroi, background: '#c8bfae' };
}

/** Découpage BSP récursif : sert au bâtiment et aux ruines. */
function decouperBsp(rng, zone, minTaille, profondeur, salles) {
  const { x, y, w, h } = zone;
  const peutVertical = w >= minTaille * 2 + 1;
  const peutHorizontal = h >= minTaille * 2 + 1;

  if (profondeur <= 0 || (!peutVertical && !peutHorizontal)) {
    salles.push(zone);
    return;
  }

  const vertical = peutVertical && (!peutHorizontal || rng() < 0.5);

  if (vertical) {
    const coupe = minTaille + Math.floor(rng() * (w - minTaille * 2));
    decouperBsp(rng, { x, y, w: coupe, h }, minTaille, profondeur - 1, salles);
    decouperBsp(rng, { x: x + coupe, y, w: w - coupe, h }, minTaille, profondeur - 1, salles);
  } else {
    const coupe = minTaille + Math.floor(rng() * (h - minTaille * 2));
    decouperBsp(rng, { x, y, w, h: coupe }, minTaille, profondeur - 1, salles);
    decouperBsp(rng, { x, y: y + coupe, w, h: h - coupe }, minTaille, profondeur - 1, salles);
  }
}

function creuserCouloir(terrain, ax, ay, bx, by) {
  let x = ax;
  let y = ay;
  while (x !== bx) { poser(terrain, x, y, null); x += bx > x ? 1 : -1; }
  while (y !== by) { poser(terrain, x, y, null); y += by > y ? 1 : -1; }
  poser(terrain, x, y, null);
}

function poserPortes(terrain, estSalle, rng, probabilite = 0.75) {
  const candidates = [];

  for (let y = 1; y < terrain.rows - 1; y += 1) {
    for (let x = 1; x < terrain.cols - 1; x += 1) {
      if (lire(terrain, x, y)) continue;
      if (estSalle[y * terrain.cols + x]) continue;

      const murGauche = !estPraticable(terrain, x - 1, y);
      const murDroite = !estPraticable(terrain, x + 1, y);
      const murHaut = !estPraticable(terrain, x, y - 1);
      const murBas = !estPraticable(terrain, x, y + 1);

      const couloirVertical = murGauche && murDroite && !murHaut && !murBas;
      const couloirHorizontal = murHaut && murBas && !murGauche && !murDroite;
      if (!couloirVertical && !couloirHorizontal) continue;

      const toucheSalle = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
        estSalle[(y + dy) * terrain.cols + (x + dx)]);

      if (toucheSalle) candidates.push({ x, y });
    }
  }

  candidates.forEach(cellule => {
    if (rng() < probabilite) poser(terrain, cellule.x, cellule.y, M.porte);
  });
}

// Thèmes de salle : c'est ce qui distingue un donjon d'une grille de
// rectangles vides. Chaque salle reçoit une fonction et un mobilier.
const THEMES_SALLE = [
  { nom: 'Corps de garde', meubles: [M.table, M.chaise, M.ratelier, M.tonneau], densite: 0.55 },
  { nom: 'Réserve',        meubles: [M.caisse, M.tonneau, M.etagere, M.coffre], densite: 0.7 },
  { nom: 'Chapelle',       meubles: [M.autel, M.brasero, M.statue],             densite: 0.35 },
  { nom: 'Bibliothèque',   meubles: [M.etagere, M.table, M.chaise],             densite: 0.6 },
  { nom: 'Dortoir',        meubles: [M.lit, M.paille, M.caisse],                densite: 0.5 },
  { nom: 'Cellules',       meubles: [M.paille, M.ossements],                    densite: 0.4 },
  { nom: 'Salle du trésor',meubles: [M.coffre, M.statue, M.piege],              densite: 0.4 },
  { nom: 'Salle vide',     meubles: [M.gravats],                                densite: 0.12 }
];

/** Bâtiment / donjon : salles thématiques, couloirs, portes, éclairage. */
function genererBatiment(terrain, rng, densite, options = {}) {
  const { cols, rows } = terrain;
  const mur = options.mur || M.murPierre;
  poserRect(terrain, 0, 0, cols, rows, mur);

  const salles = [];
  const minTaille = 5;
  // Profondeur portée à 5 : nettement plus de salles qu'en V1.13.1.
  decouperBsp(rng, { x: 0, y: 0, w: cols, h: rows }, minTaille, 5, salles);

  const estSalle = new Array(cols * rows).fill(false);
  const centres = [];

  salles.forEach(zone => {
    const marge = 1;
    const largeurMax = zone.w - marge * 2;
    const hauteurMax = zone.h - marge * 2;
    if (largeurMax < 2 || hauteurMax < 2) return;

    const w = Math.max(2, largeurMax - entre(rng, 0, Math.min(2, largeurMax - 2)));
    const h = Math.max(2, hauteurMax - entre(rng, 0, Math.min(2, hauteurMax - 2)));
    const x = zone.x + marge + entre(rng, 0, largeurMax - w);
    const y = zone.y + marge + entre(rng, 0, hauteurMax - h);

    viderRect(terrain, x, y, w, h);
    for (let dx = 0; dx < w; dx += 1) {
      for (let dy = 0; dy < h; dy += 1) estSalle[(y + dy) * cols + (x + dx)] = true;
    }

    centres.push({
      x: x + Math.floor(w / 2), y: y + Math.floor(h / 2),
      x0: x, y0: y, w, h,
      theme: choix(rng, THEMES_SALLE)
    });
  });

  for (let i = 1; i < centres.length; i += 1) {
    creuserCouloir(terrain, centres[i - 1].x, centres[i - 1].y, centres[i].x, centres[i].y);
  }

  poserPortes(terrain, estSalle, rng);

  centres.forEach(salle => {
    const theme = salle.theme;

    // Piliers dans les grandes salles : structure et couverture tactique.
    if (salle.w >= 6 && salle.h >= 6 && rng() < 0.6) {
      [[1, 1], [salle.w - 2, 1], [1, salle.h - 2], [salle.w - 2, salle.h - 2]].forEach(([dx, dy]) => {
        poserSiLibre(terrain, salle.x0 + dx, salle.y0 + dy, M.pilier);
      });
    }

    // Sol : un tapis ou un plancher distingue les salles nobles.
    if (rng() < 0.3) {
      for (let dx = 1; dx < salle.w - 1; dx += 1) {
        for (let dy = 1; dy < salle.h - 1; dy += 1) {
          poserSiLibre(terrain, salle.x0 + dx, salle.y0 + dy, rng() < 0.5 ? M.tapis : M.plancher);
        }
      }
    }

    // Mobilier selon le thème, plaqué contre les murs le plus souvent.
    const quantite = Math.round(salle.w * salle.h * 0.06 * theme.densite * densite);
    for (let i = 0; i < quantite; i += 1) {
      const contreMur = rng() < 0.7;
      const x = contreMur && rng() < 0.5
        ? (rng() < 0.5 ? salle.x0 : salle.x0 + salle.w - 1)
        : salle.x0 + entre(rng, 0, salle.w - 1);
      const y = contreMur && rng() >= 0.5
        ? (rng() < 0.5 ? salle.y0 : salle.y0 + salle.h - 1)
        : salle.y0 + entre(rng, 0, salle.h - 1);
      const materiau = choix(rng, theme.meubles);
      const occupe = lire(terrain, x, y);
      if (occupe === null || occupe === M.tapis || occupe === M.plancher) {
        poser(terrain, x, y, materiau);
      }
    }

    // Torches aux entrées : repère visuel et amorce du futur éclairage.
    if (rng() < 0.7) {
      poserSiLibre(terrain, salle.x0 + entre(rng, 0, salle.w - 1), salle.y0, M.torche);
    }
  });

  return { remplissage: mur, background: '#ded0b0', salles: centres, estSalle };
}

/** Ruines : un bâtiment effondré, envahi par la végétation. */
function genererRuines(terrain, rng, densite) {
  const base = genererBatiment(terrain, rng, densite * 0.55, { mur: M.murRuine });
  const { cols, rows } = terrain;
  const bruit = creerBruitFractal(rng, cols, rows, 6);

  // Effondrements modulés : des pans entiers tombent, plutôt qu'un
  // grignotage uniforme case par case.
  for (let y = 1; y < rows - 1; y += 1) {
    for (let x = 1; x < cols - 1; x += 1) {
      if (lire(terrain, x, y) !== M.murRuine) continue;
      const n = bruit(x, y);
      if (n > 0.62) poser(terrain, x, y, null);
      else if (n > 0.55) poser(terrain, x, y, M.gravats);
      else if (n < 0.3 && rng() < 0.25) poser(terrain, x, y, M.colonne);
    }
  }

  for (let y = 1; y < rows - 1; y += 1) {
    for (let x = 1; x < cols - 1; x += 1) {
      if (lire(terrain, x, y)) continue;
      const n = bruit(x, y);
      const tirage = rng();
      if (n > 0.6 && tirage < 0.28 * densite) poser(terrain, x, y, M.buisson);
      else if (n > 0.66 && tirage < 0.14 * densite) poser(terrain, x, y, M.arbre);
      else if (tirage < 0.09 * densite) poser(terrain, x, y, M.gravats);
      else if (tirage < 0.13 * densite) poser(terrain, x, y, M.herbes);
      else if (tirage < 0.15 * densite) poser(terrain, x, y, M.lichen);
      else if (tirage < 0.16 * densite) poser(terrain, x, y, M.ossements);
      else if (tirage < 0.17 * densite) poser(terrain, x, y, M.flaque);
    }
  }

  return { remplissage: M.murRuine, background: '#d3c9b0', salles: base.salles };
}

/** Ville : trame de rues, îlots variés, place de marché, mobilier urbain. */
function genererVille(terrain, rng, densite) {
  const { cols, rows } = terrain;
  const pas = entre(rng, 7, 10);

  const brut = [];
  const lignesBloc = [];
  for (let by = 1; by < rows - 1; by += pas) lignesBloc.push(by);

  for (let bx = 1; bx < cols - 1; bx += pas) {
    lignesBloc.forEach(by => {
      const w = Math.min(pas - 2, cols - 1 - bx);
      const h = Math.min(pas - 2, rows - 1 - by);
      if (w < 3 || h < 3) return;
      brut.push({ x: bx, y: by, w, h });
    });
  }

  if (!brut.length) return { remplissage: M.murMaison, background: '#cfc6b4' };

  // Une avenue plus large traverse la ville : hiérarchie de voirie.
  // Elle suit une rue EXISTANTE (le sillon entre deux rangées d'îlots)
  // et se contente de rogner les îlots qu'elle effleure. Écarter les
  // îlots entiers laissait une large bande vide en travers de la carte.
  const sillons = lignesBloc.slice(1).map(by => by - 1);
  const avenue = sillons.length ? choix(rng, sillons) : -10;

  if (avenue >= 0) {
    for (let x = 0; x < cols; x += 1) {
      for (let d = -1; d <= 1; d += 1) poser(terrain, x, avenue + d, M.route);
    }
  }

  /** Rogne un îlot traversé par l'avenue au lieu de le supprimer. */
  function rogner(ilot) {
    if (avenue < 0) return ilot;
    const haut = avenue - 1;
    const bas = avenue + 1;
    if (ilot.y > bas || ilot.y + ilot.h - 1 < haut) return ilot;

    const hauteurHaut = haut - ilot.y;
    const yBas = bas + 1;
    const hauteurBas = ilot.y + ilot.h - yBas;

    if (hauteurHaut >= hauteurBas) {
      return hauteurHaut >= 3 ? { ...ilot, h: hauteurHaut } : null;
    }
    return hauteurBas >= 3 ? { ...ilot, y: yBas, h: hauteurBas } : null;
  }

  const ilots = brut.map(rogner).filter(Boolean);
  if (!ilots.length) return { remplissage: M.murMaison, background: '#cfc6b4' };

  const place = choix(rng, ilots);

  ilots.forEach(ilot => {
    if (ilot === place) {
      poser(terrain, ilot.x + Math.floor(ilot.w / 2), ilot.y + Math.floor(ilot.h / 2), M.fontaine);
      for (let i = 0; i < Math.round(4 * densite); i += 1) {
        poserSiLibre(terrain, ilot.x + entre(rng, 0, ilot.w - 1), ilot.y + entre(rng, 0, ilot.h - 1), M.etal);
      }
      poserSiLibre(terrain, ilot.x, ilot.y, M.charrette);
      return;
    }

    const tirage = rng();

    // Un îlot sur six reste un jardin ou un terrain vague : la ville
    // cesse d'être une grille parfaite de maisons identiques.
    if (tirage > 0.86 * densite) {
      for (let dx = 0; dx < ilot.w; dx += 1) {
        for (let dy = 0; dy < ilot.h; dy += 1) {
          if (rng() < 0.5) poserSiLibre(terrain, ilot.x + dx, ilot.y + dy, rng() < 0.3 ? M.arbre : M.jardin);
        }
      }
      poserSiLibre(terrain, ilot.x + Math.floor(ilot.w / 2), ilot.y + Math.floor(ilot.h / 2), M.puits);
      return;
    }

    // Îlot bâti : une ou deux maisons de tailles différentes.
    const maisons = ilot.w >= 6 && rng() < 0.5
      ? [{ x: ilot.x, y: ilot.y, w: Math.floor(ilot.w / 2), h: ilot.h },
         { x: ilot.x + Math.floor(ilot.w / 2), y: ilot.y, w: Math.ceil(ilot.w / 2), h: ilot.h }]
      : [ilot];

    maisons.forEach(maison => {
      if (maison.w < 3 || maison.h < 3) return;

      for (let dx = 0; dx < maison.w; dx += 1) {
        poser(terrain, maison.x + dx, maison.y, M.murMaison);
        poser(terrain, maison.x + dx, maison.y + maison.h - 1, M.murMaison);
      }
      for (let dy = 0; dy < maison.h; dy += 1) {
        poser(terrain, maison.x, maison.y + dy, M.murMaison);
        poser(terrain, maison.x + maison.w - 1, maison.y + dy, M.murMaison);
      }

      const facade = entre(rng, 0, 3);
      if (facade === 0) poser(terrain, maison.x + entre(rng, 1, maison.w - 2), maison.y, M.porte);
      else if (facade === 1) poser(terrain, maison.x + entre(rng, 1, maison.w - 2), maison.y + maison.h - 1, M.porte);
      else if (facade === 2) poser(terrain, maison.x, maison.y + entre(rng, 1, maison.h - 2), M.porte);
      else poser(terrain, maison.x + maison.w - 1, maison.y + entre(rng, 1, maison.h - 2), M.porte);

      const meubles = [M.table, M.chaise, M.tonneau, M.caisse, M.lit, M.etagere, M.coffre];
      const quantite = Math.round((maison.w - 2) * (maison.h - 2) * 0.22 * densite);
      for (let i = 0; i < quantite; i += 1) {
        poserSiLibre(terrain,
          maison.x + entre(rng, 1, maison.w - 2),
          maison.y + entre(rng, 1, maison.h - 2), choix(rng, meubles));
      }
    });
  });

  // Mobilier urbain le long des rues.
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (lire(terrain, x, y)) continue;
      const borde = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .some(([dx, dy]) => lire(terrain, x + dx, y + dy) === M.murMaison);
      if (!borde) continue;
      const tirage = rng();
      if (tirage < 0.05 * densite) poser(terrain, x, y, M.lampadaire);
      else if (tirage < 0.09 * densite) poser(terrain, x, y, M.tonneau);
      else if (tirage < 0.11 * densite) poser(terrain, x, y, M.caisse);
      else if (tirage < 0.125 * densite) poser(terrain, x, y, M.charrette);
    }
  }

  return { remplissage: M.murMaison, background: '#cbc2af' };
}

/** Plaine : espace ouvert, rivière et pont, bosquets, cultures. */
function genererPlaine(terrain, rng, densite) {
  const { cols, rows } = terrain;
  const bruit = creerBruitFractal(rng, cols, rows, 8);

  if (rng() < 0.8) tracerCoursDeau(terrain, rng, { vertical: true });

  // Bosquets guidés par le bruit plutôt que semés au hasard.
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (lire(terrain, x, y)) continue;
      const n = bruit(x, y);
      if (n > 0.70 && rng() < 0.75 * densite) poser(terrain, x, y, M.arbre);
      else if (n > 0.63 && rng() < 0.45 * densite) poser(terrain, x, y, M.buisson);
    }
  }

  // Parcelles cultivées entourées d'un muret : trace d'occupation humaine.
  const parcelles = Math.round(2 * densite);
  for (let i = 0; i < parcelles; i += 1) {
    const w = entre(rng, 4, 8);
    const h = entre(rng, 3, 6);
    const x = entre(rng, 1, Math.max(1, cols - w - 2));
    const y = entre(rng, 1, Math.max(1, rows - h - 2));
    for (let dx = 0; dx < w; dx += 1) {
      for (let dy = 0; dy < h; dy += 1) {
        const bord = dx === 0 || dy === 0 || dx === w - 1 || dy === h - 1;
        if (bord && rng() < 0.75) poserSiLibre(terrain, x + dx, y + dy, M.muret);
        else poserSiLibre(terrain, x + dx, y + dy, M.culture);
      }
    }
  }

  // Campement occasionnel.
  if (rng() < 0.5) {
    const cx = entre(rng, 3, cols - 4);
    const cy = entre(rng, 3, rows - 4);
    poserSiLibre(terrain, cx, cy, M.feu);
    poserSiLibre(terrain, cx + 1, cy + 1, M.tente);
    poserSiLibre(terrain, cx - 1, cy + 1, M.charrette);
  }

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (lire(terrain, x, y)) continue;
      const n = bruit(x, y);
      const tirage = rng();
      if (n < 0.4 && tirage < 0.22 * densite) poser(terrain, x, y, M.herbes);
      else if (tirage < 0.05 * densite) poser(terrain, x, y, M.fleurs);
      else if (tirage < 0.075 * densite) poser(terrain, x, y, M.rocher);
      else if (tirage < 0.085 * densite) poser(terrain, x, y, M.bloc);
      else if (tirage < 0.095 * densite) poser(terrain, x, y, M.arbreMort);
    }
  }

  return { remplissage: M.rocher, background: '#dfe4c2' };
}

/** Désert : cordons de dunes, oasis, rochers, ruines ensablées. */
function genererDesert(terrain, rng, densite) {
  const { cols, rows } = terrain;
  const bruitDunes = creerBruitFractal(rng, cols, rows, 9);
  const bruitDetail = creerBruitFractal(rng, cols, rows, 4);

  // Cordons de dunes orientés : des bandes, pas des taches.
  const angle = rng() * Math.PI;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const onde = Math.sin((x * ux + y * uy) / 3.2 + bruitDunes(x, y) * 4);
      if (onde > 0.72) poser(terrain, x, y, M.dune);
      else if (onde > 0.45 && rng() < 0.5) poser(terrain, x, y, M.sableMou);
    }
  }

  // Oasis : point d'eau entouré de palmiers, dégagé de sable.
  if (rng() < 0.85) {
    const cx = entre(rng, 5, cols - 6);
    const cy = entre(rng, 5, rows - 6);
    const rayon = entre(rng, 2, 4);
    viderDisque(terrain, cx, cy, rayon + 2);
    for (let x = cx - rayon; x <= cx + rayon; x += 1) {
      for (let y = cy - rayon; y <= cy + rayon; y += 1) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= rayon - 1) poser(terrain, x, y, M.eau);
        else if (d <= rayon) poser(terrain, x, y, M.flaque);
      }
    }
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      poserSiLibre(terrain,
        Math.round(cx + Math.cos(a) * (rayon + 1.6)),
        Math.round(cy + Math.sin(a) * (rayon + 1.6)), M.palmier);
    }
    poserSiLibre(terrain, cx + rayon + 2, cy, M.tente);
  }

  // Ruines ensablées : pans de mur et colonnes, alignés comme un bâtiment.
  if (rng() < 0.75) {
    const w = entre(rng, 6, 12);
    const h = entre(rng, 5, 9);
    const x0 = entre(rng, 1, Math.max(1, cols - w - 2));
    const y0 = entre(rng, 1, Math.max(1, rows - h - 2));
    viderRect(terrain, x0, y0, w, h);
    for (let dx = 0; dx < w; dx += 1) {
      if (rng() < 0.65) poser(terrain, x0 + dx, y0, M.murSable);
      if (rng() < 0.65) poser(terrain, x0 + dx, y0 + h - 1, M.murSable);
    }
    for (let dy = 0; dy < h; dy += 1) {
      if (rng() < 0.65) poser(terrain, x0, y0 + dy, M.murSable);
      if (rng() < 0.65) poser(terrain, x0 + w - 1, y0 + dy, M.murSable);
    }
    for (let i = 0; i < 5; i += 1) {
      poserSiLibre(terrain, x0 + entre(rng, 1, w - 2), y0 + entre(rng, 1, h - 2),
        rng() < 0.6 ? M.colonne : M.gravats);
    }
    poserSiLibre(terrain, x0 + Math.floor(w / 2), y0 + Math.floor(h / 2), M.statue);
  }

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (lire(terrain, x, y)) continue;
      const n = bruitDetail(x, y);
      const tirage = rng();
      if (n > 0.66 && tirage < 0.16 * densite) poser(terrain, x, y, M.rocher);
      else if (n > 0.6 && tirage < 0.10 * densite) poser(terrain, x, y, M.bloc);
      else if (tirage < 0.05 * densite) poser(terrain, x, y, M.cactus);
      else if (tirage < 0.085 * densite) poser(terrain, x, y, M.broussaille);
      else if (tirage < 0.10 * densite) poser(terrain, x, y, M.ossements);
      else if (tirage < 0.11 * densite) poser(terrain, x, y, M.gravats);
    }
  }

  return { remplissage: M.rocher, background: '#ead9b0' };
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

const GENERATEURS = Object.freeze({
  foret: {
    id: 'foret', nom: 'Forêt', icone: '🌲',
    description: 'Bosquets, clairières aménagées, ruisseau et sentier traversant.',
    defaut: { cols: 40, rows: 28, cellSize: 32 },
    generer: genererForet
  },
  caverne: {
    id: 'caverne', nom: 'Caverne', icone: '🕳️',
    description: 'Galeries organiques, chambres reliées, lac souterrain et concrétions.',
    defaut: { cols: 44, rows: 30, cellSize: 30 },
    generer: genererCaverne
  },
  batiment: {
    id: 'batiment', nom: 'Bâtiment / Donjon', icone: '🏰',
    description: 'Salles thématiques meublées, couloirs, portes et éclairage.',
    defaut: { cols: 40, rows: 28, cellSize: 32 },
    generer: genererBatiment
  },
  ruines: {
    id: 'ruines', nom: 'Ruines', icone: '🏚️',
    description: 'Bâtiment effondré, colonnes brisées, gravats et végétation envahissante.',
    defaut: { cols: 40, rows: 28, cellSize: 32 },
    generer: genererRuines
  },
  ville: {
    id: 'ville', nom: 'Ville / Village', icone: '🏘️',
    description: 'Avenue, îlots variés, maisons meublées, place de marché et jardins.',
    defaut: { cols: 46, rows: 32, cellSize: 28 },
    generer: genererVille
  },
  plaine: {
    id: 'plaine', nom: 'Plaine', icone: '🌾',
    description: 'Terrain ouvert, rivière franchissable, bosquets et parcelles cultivées.',
    defaut: { cols: 42, rows: 28, cellSize: 32 },
    generer: genererPlaine
  },
  desert: {
    id: 'desert', nom: 'Désert', icone: '🏜️',
    description: 'Cordons de dunes, oasis, ruines ensablées, cactus et ossements.',
    defaut: { cols: 42, rows: 28, cellSize: 32 },
    generer: genererDesert
  }
});

function getGenerateurs() {
  return Object.values(GENERATEURS).map(g => ({
    id: g.id,
    nom: g.nom,
    icone: g.icone,
    description: g.description,
    defaut: { ...g.defaut }
  }));
}

/**
 * Génère un décor complet.
 * Retourne un objet directement consommable par map.createMap() ou
 * map.remplacerDecor() : ce ne sont que des `elements` standards.
 */
function genererCarte(typeId, options = {}) {
  const generateur = GENERATEURS[typeId];
  if (!generateur) {
    return { success: false, message: 'Type de carte inconnu.' };
  }

  const cols = Math.max(8, Math.min(80, Math.round(Number(options.cols) || generateur.defaut.cols)));
  const rows = Math.max(8, Math.min(80, Math.round(Number(options.rows) || generateur.defaut.rows)));
  const cellSize = Math.max(16, Math.min(160,
    Math.round(Number(options.cellSize) || generateur.defaut.cellSize)));

  const densiteBrute = Number(options.density);
  const densite = Number.isFinite(densiteBrute)
    ? Math.max(0.2, Math.min(2, densiteBrute))
    : 1;

  const graine = options.seed !== undefined && options.seed !== null && String(options.seed).trim()
    ? String(options.seed).trim()
    : String(hachageGraine(`${typeId}${cols}${rows}${densite}`) % 100000);

  const rng = creerRng(`${typeId}:${graine}:${cols}x${rows}:${densite}`);
  const terrain = creerTerrain(cols, rows);

  const resultat = generateur.generer(terrain, rng, densite) || {};
  const principale = garantirConnexite(terrain, resultat.remplissage || M.rocher);
  const apparitions = calculerApparitions(terrain, principale, rng);

  return {
    success: true,
    type: generateur.id,
    nom: `${generateur.nom} — ${graine}`,
    seed: graine,
    grid: { cols, rows, cellSize, showGrid: true },
    background: { color: resultat.background || '#fffdf7' },
    elements: terrainVersElements(terrain),
    spawn: apparitions,
    praticables: principale.length
  };
}

module.exports = {
  GENERATEURS,
  MATERIAUX,
  CATEGORIES,
  PALETTES,
  getGenerateurs,
  getPalette,
  getMateriau,
  genererCarte,
  // Exportés pour les tests.
  creerRng,
  creerBruitFractal,
  terrainVersElements,
  garantirConnexite
};
