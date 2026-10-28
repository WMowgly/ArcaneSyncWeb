// mapgen.js
// ---------------------------------------------------------------------------
// Catalogue de décors : matériaux et palettes par type de lieu.
//
// Ce module est PUR : il ne lit ni n'écrit aucun fichier. Il décrit les
// « pinceaux » de décor (arbre, mur, tonneau...) que map.js sait poser comme
// des `elements` ordinaires, et propose pour chaque type de lieu une palette
// cohérente (pas de cactus dans un donjon).
//
// Le serveur résout lui-même un pinceau envoyé par le client (getMateriau) :
// le client ne dicte jamais les propriétés d'un élément.
//
// V1.16 : le moteur de génération automatique de cartes (bruit, automates,
// découpage BSP...) a été retiré ; il n'était plus proposé dans l'interface.
// ---------------------------------------------------------------------------

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

// Portée d'éclairage des matériaux lumineux, en cases. Le lichen
// (« Lichen luminescent ») éclaire faiblement son recoin.
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


// ---------------------------------------------------------------------------
// PALETTES PAR TYPE DE LIEU
//
// Le MJ ne doit pas se voir proposer un cactus dans un donjon. Chaque
// biome déclare la liste des matériaux qu'il propose ; une poignée de
// matériaux universels reste toujours disponible.
//
// Ajouter un biome = ajouter une entrée ici.
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

module.exports = {
  MATERIAUX,
  CATEGORIES,
  PALETTES,
  getPalette,
  getMateriau
};
