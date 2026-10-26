// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
// tests/mapgen.test.js
// ---------------------------------------------------------------------------
// V1.13.1 — Génération de cartes par type de lieu.
//
// Vérifie que chaque générateur produit une carte JOUABLE : une seule zone
// praticable connexe, des points d'apparition valides, et un décor composé
// d'éléments standards donc entièrement modifiable ensuite.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const mapsFile = bacDonnees.chemin('maps.json');
const originalMaps = fs.existsSync(mapsFile) ? fs.readFileSync(mapsFile, 'utf8') : null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Reconstruit la grille de blocage depuis les éléments produits et compte
 * les composantes connexes praticables (4-connexité).
 */
function analyserConnexite(resultat) {
  const { cols, rows } = resultat.grid;
  const bloque = new Set();

  resultat.elements.forEach(element => {
    if (!element.blocksMovement) return;
    for (let dx = 0; dx < element.w; dx += 1) {
      for (let dy = 0; dy < element.h; dy += 1) {
        bloque.add(`${element.x + dx},${element.y + dy}`);
      }
    }
  });

  const vus = new Set();
  let composantes = 0;
  let plusGrande = 0;

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const cle = `${x},${y}`;
      if (vus.has(cle) || bloque.has(cle)) continue;

      composantes += 1;
      let taille = 0;
      const pile = [[x, y]];
      vus.add(cle);

      while (pile.length) {
        const [cx, cy] = pile.pop();
        taille += 1;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
          const nx = cx + dx;
          const ny = cy + dy;
          const k = `${nx},${ny}`;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return;
          if (vus.has(k) || bloque.has(k)) return;
          vus.add(k);
          pile.push([nx, ny]);
        });
      }

      plusGrande = Math.max(plusGrande, taille);
    }
  }

  return { composantes, plusGrande, bloque };
}

try {
  delete require.cache[require.resolve('../mapgen')];
  delete require.cache[require.resolve('../map')];
  const mapGen = require('../mapgen');
  const mapStore = require('../map');
  mapStore.activerBrouillard(true); // désactivé dans l'appli, toujours testé

  // ---------------------------------------------------------------------
  // 1. Catalogue
  // ---------------------------------------------------------------------
  const catalogue = mapGen.getGenerateurs();
  assert(catalogue.length >= 7, 'Le catalogue doit proposer au moins 7 types de lieux.');

  ['foret', 'caverne', 'batiment', 'ruines', 'ville', 'plaine', 'desert'].forEach(id => {
    const entree = catalogue.find(g => g.id === id);
    assert(entree, `Type de lieu manquant : ${id}`);
    assert(entree.nom && entree.description, `Métadonnées incomplètes pour ${id}.`);
    // V1.13.4 : les cartes par défaut sont nettement plus grandes.
    assert(entree.defaut.cols >= 36 && entree.defaut.rows >= 26,
      `Dimensions par défaut trop petites pour ${id} (${entree.defaut.cols}x${entree.defaut.rows}).`);
  });

  assert(mapGen.genererCarte('inconnu', {}).success === false, 'Un type inconnu doit être refusé.');

  // ---------------------------------------------------------------------
  // 1 bis. Palettes de décor propres au biome
  // ---------------------------------------------------------------------
  const attendus = {
    foret: ['arbre', 'buisson', 'rocher'],
    batiment: ['murPierre', 'porte', 'coffre', 'table'],
    ville: ['murMaison', 'lampadaire', 'etal'],
    desert: ['cactus', 'dune', 'palmier'],
    caverne: ['paroi', 'stalagmite', 'cristal']
  };

  Object.entries(attendus).forEach(([type, ids]) => {
    const palette = mapGen.getPalette(type);
    assert(palette.type === type, `Palette non résolue pour ${type}.`);
    assert(palette.groupes.length >= 3, `Palette trop pauvre pour ${type}.`);

    const disponibles = palette.groupes.flatMap(g => g.elements.map(e => e.id));
    ids.forEach(id => assert(disponibles.includes(id),
      `« ${id} » devrait être proposé pour une carte de type ${type}.`));

    palette.groupes.forEach(groupe => {
      assert(groupe.nom && groupe.elements.length, `Groupe vide dans la palette ${type}.`);
      groupe.elements.forEach(element => {
        assert(element.id && element.nom && element.kind,
          `Élément de palette incomplet dans ${type}.`);
      });
    });
  });

  // Un cactus n'a rien à faire dans un donjon, ni un râtelier dans un désert.
  const paletteDonjon = mapGen.getPalette('batiment').groupes.flatMap(g => g.elements.map(e => e.id));
  assert(!paletteDonjon.includes('cactus'), 'Le cactus ne doit pas être proposé dans un donjon.');
  assert(!paletteDonjon.includes('palmier'), 'Le palmier ne doit pas être proposé dans un donjon.');
  const paletteDesert = mapGen.getPalette('desert').groupes.flatMap(g => g.elements.map(e => e.id));
  assert(!paletteDesert.includes('ratelier'), "Le râtelier d'armes n'a pas sa place dans un désert.");

  // Une carte sans type reçoit la palette complète : le MJ n'est jamais bloqué.
  const generique = mapGen.getPalette('');
  assert(generique.type === '', 'Une palette générique ne doit pas revendiquer de type.');
  assert(generique.groupes.flatMap(g => g.elements).length > paletteDonjon.length,
    'La palette générique doit être la plus large.');

  // Résolution serveur d'un pinceau : le client ne dicte pas les propriétés.
  const pinceau = mapGen.getMateriau('arbre');
  assert(pinceau && pinceau.blocksVision === true && pinceau.blocksMovement === true,
    'Le pinceau « arbre » doit bloquer vue et passage.');
  assert(pinceau.id === undefined && pinceau.categorie === undefined,
    "Un pinceau ne doit exposer que les champs d'un élément de carte.");
  assert(mapGen.getMateriau('licorne') === null, 'Un pinceau inconnu doit être refusé.');

  // ---------------------------------------------------------------------
  // 2. Chaque type produit une carte jouable
  // ---------------------------------------------------------------------
  const kindsValides = new Set(Object.keys(mapStore.KINDS_ELEMENT));

  catalogue.forEach(entree => {
    ['alpha', 'beta', 'gamma'].forEach(graine => {
      const resultat = mapGen.genererCarte(entree.id, { seed: graine });

      assert(resultat.success, `Génération impossible pour ${entree.id}.`);
      assert(resultat.type === entree.id, `Type retourné incorrect pour ${entree.id}.`);
      assert(resultat.seed === graine, `La graine doit être restituée (${entree.id}).`);
      assert(Array.isArray(resultat.elements), `Éléments manquants pour ${entree.id}.`);
      assert(resultat.elements.length > 0, `Un lieu généré ne doit pas être vide (${entree.id}).`);
      assert(/^#[0-9a-f]{6}$/i.test(resultat.background.color), `Couleur de fond invalide (${entree.id}).`);

      // Les éléments doivent rester dans la grille et utiliser des types connus.
      resultat.elements.forEach(element => {
        assert(kindsValides.has(element.kind), `Type d'élément inconnu « ${element.kind} » (${entree.id}).`);
        assert(element.x >= 0 && element.y >= 0, `Élément hors grille (${entree.id}).`);
        assert(element.x + element.w <= resultat.grid.cols, `Élément débordant en largeur (${entree.id}).`);
        assert(element.y + element.h <= resultat.grid.rows, `Élément débordant en hauteur (${entree.id}).`);
      });

      // Jouabilité : une seule zone praticable, suffisamment grande.
      const analyse = analyserConnexite(resultat);
      assert(analyse.composantes === 1,
        `${entree.id}/${graine} : ${analyse.composantes} zones isolées, la carte doit être connexe.`);
      assert(analyse.plusGrande >= 25,
        `${entree.id}/${graine} : zone praticable trop petite (${analyse.plusGrande} cases).`);
      assert(analyse.plusGrande === resultat.praticables,
        `${entree.id}/${graine} : incohérence du décompte des cases praticables.`);

      // Points d'apparition réellement utilisables.
      assert(resultat.spawn.length > 0, `Aucun point d'apparition (${entree.id}).`);
      resultat.spawn.forEach(cellule => {
        assert(!analyse.bloque.has(`${cellule.x},${cellule.y}`),
          `${entree.id} : un point d'apparition est dans un obstacle.`);
      });

      // V1.13.4 : richesse. Une carte ne doit plus ressembler à une grille
      // de démonstration parsemée de trois symboles identiques.
      const varietes = new Set(resultat.elements.map(e => e.nom)).size;
      assert(varietes >= 8,
        `${entree.id}/${graine} : seulement ${varietes} types d'éléments distincts.`);

      const casesDecorees = resultat.elements.reduce((total, e) => total + e.w * e.h, 0);
      const occupation = casesDecorees / (resultat.grid.cols * resultat.grid.rows);
      assert(occupation > 0.18,
        `${entree.id}/${graine} : carte trop vide (${Math.round(occupation * 100)} % de cases décorées).`);

      // Le décor ne doit pas non plus étouffer la carte.
      assert(analyse.plusGrande / (resultat.grid.cols * resultat.grid.rows) > 0.2,
        `${entree.id}/${graine} : zone jouable trop réduite.`);
    });
  });

  // Deux graines doivent produire des cartes réellement différentes,
  // pas la même structure avec quelques cailloux déplacés.
  ['foret', 'ville', 'desert'].forEach(type => {
    const a = mapGen.genererCarte(type, { seed: 'VAR-A' });
    const b = mapGen.genererCarte(type, { seed: 'VAR-B' });
    const cles = r => new Set(r.elements.map(e => `${e.x},${e.y},${e.nom}`));
    const ca = cles(a);
    const cb = cles(b);
    const communs = [...ca].filter(k => cb.has(k)).length;
    const ratio = communs / Math.max(ca.size, cb.size);
    assert(ratio < 0.35,
      `${type} : deux graines produisent des cartes trop semblables (${Math.round(ratio * 100)} % communs).`);
  });

  // Performance : la génération doit rester utilisable dans l'application.
  const debut = Date.now();
  catalogue.forEach(entree => mapGen.genererCarte(entree.id, { seed: 'PERF' }));
  const duree = Date.now() - debut;
  assert(duree < 2000, `Génération trop lente : ${duree} ms pour ${catalogue.length} cartes.`);

  // ---------------------------------------------------------------------
  // 3. Déterminisme
  // ---------------------------------------------------------------------
  const a = mapGen.genererCarte('caverne', { seed: 'MEMEGRAINE' });
  const b = mapGen.genererCarte('caverne', { seed: 'MEMEGRAINE' });
  const c = mapGen.genererCarte('caverne', { seed: 'AUTREGRAINE' });

  assert(JSON.stringify(a.elements) === JSON.stringify(b.elements),
    'Une même graine doit toujours redonner la même carte.');
  assert(JSON.stringify(a.elements) !== JSON.stringify(c.elements),
    'Deux graines différentes doivent donner des cartes différentes.');

  // Une graine absente reste déterministe pour un même jeu de paramètres.
  const sansGraine1 = mapGen.genererCarte('foret', { cols: 20, rows: 14 });
  const sansGraine2 = mapGen.genererCarte('foret', { cols: 20, rows: 14 });
  assert(sansGraine1.seed === sansGraine2.seed, 'La graine implicite doit être stable.');

  // ---------------------------------------------------------------------
  // 4. Bornes et densité
  // ---------------------------------------------------------------------
  const enorme = mapGen.genererCarte('plaine', { cols: 9999, rows: -5, seed: 'B' });
  assert(enorme.grid.cols <= 80 && enorme.grid.rows >= 8, 'Les dimensions doivent être bornées.');

  const clairsemee = mapGen.genererCarte('foret', { seed: 'D', density: 0.2 });
  const dense = mapGen.genererCarte('foret', { seed: 'D', density: 2 });
  assert(analyserConnexite(clairsemee).plusGrande > analyserConnexite(dense).plusGrande,
    'Une densité plus faible doit laisser davantage de cases praticables.');

  // ---------------------------------------------------------------------
  // 5. Compactage en rectangles
  // ---------------------------------------------------------------------
  const compacte = mapGen.genererCarte('batiment', { seed: 'COMPACT' });
  const casesCouvertes = compacte.elements.reduce((total, e) => total + e.w * e.h, 0);
  assert(compacte.elements.length < casesCouvertes,
    'Les cases identiques adjacentes doivent être fusionnées en rectangles.');
  assert(compacte.elements.some(e => e.w > 1 || e.h > 1),
    'Le compactage doit produire au moins un élément multi-cases.');

  // ---------------------------------------------------------------------
  // 6. Intégration avec map.js — une carte générée reste modifiable
  // ---------------------------------------------------------------------
  const genere = mapGen.genererCarte('batiment', { seed: 'INTEGRATION' });
  const creation = mapStore.createMap({
    nom: '__TEST_GEN__',
    grid: genere.grid,
    background: genere.background,
    elements: genere.elements
  });

  assert(creation.success, 'Création de la carte générée impossible.');
  const mapId = creation.map.id;
  assert(Object.keys(creation.map.elements).length === genere.elements.length,
    'Tous les éléments générés doivent être conservés.');

  // Le décor généré est éditable comme n'importe quel élément.
  const premierElement = Object.keys(creation.map.elements)[0];
  assert(mapStore.updateElement(mapId, premierElement, { nom: 'Mur modifié à la main' }).success,
    'Un élément généré doit rester modifiable.');
  assert(mapStore.supprimerElement(mapId, premierElement).success,
    'Un élément généré doit rester supprimable.');
  assert(mapStore.ajouterElement(mapId, { kind: 'objet', x: 1, y: 1 }).success,
    'On doit pouvoir ajouter un élément à une carte générée.');

  // ---------------------------------------------------------------------
  // 7. Régénération : les tokens survivent et sortent des obstacles
  // ---------------------------------------------------------------------
  const plate = mapStore.createMap({ nom: '__TEST_REGEN__', grid: { cols: 12, rows: 10, cellSize: 40 } });
  const plateId = plate.map.id;

  mapStore.placerToken(plateId, { kind: 'player', entityId: 'char_regen', x: 0, y: 0 });
  mapStore.setFogConfig(plateId, { enabled: true, mode: 'vision' });
  mapStore.revelerCellules(plateId, [{ x: 4, y: 4 }], true);
  assert(mapStore.getMapById(plateId).fog.revealed.length === 1, 'Case explorée non enregistrée.');

  const remplacement = mapStore.remplacerDecor(plateId, {
    // Un mur recouvre exactement la case du token.
    elements: [{ kind: 'mur', x: 0, y: 0, w: 1, h: 1 }],
    spawn: [{ x: 5, y: 5 }],
    background: { color: '#111111' }
  });

  assert(remplacement.success, 'Remplacement du décor impossible.');
  const apres = mapStore.getMapById(plateId);
  const token = apres.tokens['player:char_regen'];

  assert(token, 'Le token doit survivre à une régénération.');
  assert(!(token.x === 0 && token.y === 0), 'Un token pris dans un mur doit être déplacé.');
  assert(token.x === 5 && token.y === 5, "Le token doit rejoindre le point d'apparition fourni.");
  assert(Object.keys(apres.elements).length === 1, "L'ancien décor doit être entièrement remplacé.");
  assert(apres.fog.revealed.length === 0,
    "La mémoire d'exploration doit être effacée : elle décrivait un décor disparu.");
  assert(apres.background.color === '#111111', 'Le fond de carte doit suivre la régénération.');

  // Un nouveau personnage ne doit jamais apparaître dans un mur.
  const sync = mapStore.synchroniserTokens(plateId, {
    players: [{ id: 'char_regen' }, { id: 'char_nouveau' }],
    mobs: []
  });
  const nouveau = sync.map.tokens['player:char_nouveau'];
  assert(nouveau, 'Le nouveau personnage doit être placé.');
  assert(!(nouveau.x === 0 && nouveau.y === 0), 'Un personnage ne doit pas être placé dans un mur.');

  mapStore.deleteMap(mapId);
  mapStore.deleteMap(plateId);

  // ---------------------------------------------------------------------
  // 8. Câblage serveur et interface
  // ---------------------------------------------------------------------
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert(serverSource.includes("app.get('/api/map/generators'"), 'Catalogue de générateurs absent du serveur.');
  assert(serverSource.includes("app.get('/api/map/palette'"), 'Route de palette absente du serveur.');
  assert(serverSource.includes("require('./mapgen')"), 'Catalogue de décors non branché.');
  assert(serverSource.includes('mapGen.getMateriau'),
    'Le serveur doit résoudre lui-même le pinceau envoyé par le client.');
  // La génération automatique a été retirée de l'application : le moteur
  // reste testé ci-dessus, mais n'est plus exposé.
  assert(!serverSource.includes("app.post('/api/maps/generate'"), 'Route de génération encore exposée.');
  assert(!serverSource.includes("app.post('/api/maps/:mapId/regenerate'"), 'Route de régénération encore exposée.');
  assert(!serverSource.includes("app.post('/api/map/generate-preview'"), "Route d'aperçu encore exposée.");

  const mjSource = fs.readFileSync(path.join(__dirname, '..', 'website', 'map.html'), 'utf8');
  assert(!mjSource.includes('btn-generate') && !mjSource.includes('btn-regenerate') && !mjSource.includes('gen-seed'),
    "L'interface MJ ne doit plus proposer de génération.");
  assert(mjSource.includes('ins-door'), 'Bascule ouvrir/fermer des portes absente de l\'inspecteur.');
  // Le pinceau de décor du MJ est désormais un nuancier de 16 couleurs ;
  // la palette par biome reste disponible côté serveur (testée ci-dessus).
  assert((mjSource.match(/data-couleur="#[0-9a-f]{6}"/gi) || []).length >= 6 + 16,
    'Le nuancier de 16 couleurs du décor (et les 6 des annotations) doit être présent.');
  assert(mjSource.includes("kind: 'couleur'"), 'Le pinceau doit poser des cases de couleur.');
  assert(!mjSource.includes('data-brush') && !mjSource.includes('fog-reveal'),
    'Palette de décors et outils de brouillard retirés de l’interface MJ.');
  assert(mjSource.includes('ouvrirModaleEntite'), 'Modale de propriétés absente de l\'interface MJ.');
  assert(mjSource.includes('mod-hp-cur') && mjSource.includes('mod-mana-cur'),
    'La modale doit permettre de modifier PV et mana.');

  const joueurSource = fs.readFileSync(path.join(__dirname, '..', 'website', 'map_joueur.html'), 'utf8');
  assert(!joueurSource.includes('regenerate'), "L'interface joueur ne doit exposer aucun outil de génération.");
  assert(!joueurSource.includes('data-brush'), "L'interface joueur ne doit pas exposer la palette de décors.");
  assert(!joueurSource.includes('ouvrirModaleEntite'),
    "L'interface joueur ne doit pas exposer l'édition des PV/PM.");

  console.log('PASS: V1.13.4 génération — 7 biomes enrichis, palettes contextuelles, variété et performance');
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

  delete require.cache[require.resolve('../mapgen')];
  delete require.cache[require.resolve('../map')];
}
