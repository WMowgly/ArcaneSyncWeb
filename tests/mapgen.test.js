// Bac a sable de donnees : DOIT rester le tout premier require.
require('./_donnees');
// tests/mapgen.test.js
// ---------------------------------------------------------------------------
// Catalogue de décors : palettes par type de lieu et résolution des pinceaux.
//
// V1.16 : le moteur de génération automatique a été retiré (il n'était plus
// proposé dans l'interface) ; seul le catalogue de décors reste.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const mapGen = require('../mapgen');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------
// 1. Palettes de décor propres au type de lieu
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
      assert(element.id && element.nom && element.kind, `Élément de palette incomplet dans ${type}.`);
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

// ---------------------------------------------------------------------
// 2. Résolution serveur d'un pinceau : le client ne dicte pas les propriétés
// ---------------------------------------------------------------------
const pinceau = mapGen.getMateriau('arbre');
assert(pinceau && pinceau.blocksVision === true && pinceau.blocksMovement === true,
  'Le pinceau « arbre » doit bloquer vue et passage.');
assert(pinceau.id === undefined && pinceau.categorie === undefined,
  "Un pinceau ne doit exposer que les champs d'un élément de carte.");
assert(mapGen.getMateriau('licorne') === null, 'Un pinceau inconnu doit être refusé.');
assert(mapGen.getMateriau('torche').lightRange === 5, 'Une torche doit éclairer à 5 cases.');

// ---------------------------------------------------------------------
// 3. Câblage serveur et interface
// ---------------------------------------------------------------------
const serverSource = require('./_sources').sourceServeur();
assert(serverSource.includes("app.get('/api/map/palette'"), 'Route de palette absente du serveur.');
assert(/require\('\.\.?\/mapgen'\)/.test(serverSource), 'Catalogue de décors non branché.');
assert(serverSource.includes('mapGen.getMateriau'),
  'Le serveur doit résoudre lui-même le pinceau envoyé par le client.');
// La génération automatique a été retirée, moteur compris.
assert(typeof mapGen.genererCarte === 'undefined', 'Le moteur de génération doit avoir été retiré.');
for (const route of ["app.get('/api/map/generators'", "app.post('/api/maps/generate'",
  "app.post('/api/maps/:mapId/regenerate'", "app.post('/api/map/generate-preview'"]) {
  assert(!serverSource.includes(route), `Route de génération encore exposée : ${route}`);
}

const mjSource = fs.readFileSync(path.join(__dirname, '..', 'website', 'map.html'), 'utf8');
assert(!mjSource.includes('btn-generate') && !mjSource.includes('btn-regenerate') && !mjSource.includes('gen-seed'),
  "L'interface MJ ne doit plus proposer de génération.");
assert(mjSource.includes('ins-door'), 'Bascule ouvrir/fermer des portes absente de l\'inspecteur.');
// Le pinceau de décor du MJ est un nuancier de 16 couleurs.
assert((mjSource.match(/data-couleur="#[0-9a-f]{6}"/gi) || []).length >= 6 + 16,
  'Le nuancier de 16 couleurs du décor (et les 6 des annotations) doit être présent.');
assert(mjSource.includes("kind: 'couleur'"), 'Le pinceau doit poser des cases de couleur.');
assert(!mjSource.includes('data-brush') && !mjSource.includes('fog-reveal'),
  'Palette de décors et outils de brouillard retirés de l’interface MJ.');
assert(mjSource.includes('ouvrirModaleEntite'), 'Modale de propriétés absente de l\'interface MJ.');
assert(mjSource.includes('mod-hp-cur') && mjSource.includes('mod-mana-cur'),
  'La modale doit permettre de modifier PV et mana.');

console.log('PASS: catalogue de décors — palettes par type de lieu, pinceaux résolus par le serveur');
