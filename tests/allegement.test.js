// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
const fs = require('fs');
const path = require('path');

const allegement = require('../allegement');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Sérialisation à clés triées.
 *
 * La fusion retire puis réinsère les champs repris : leur ORDRE dans
 * l'objet change, sans que le contenu bouge d'un octet. Comparer avec un
 * JSON.stringify brut ferait échouer un test parfaitement satisfait —
 * et l'ordre des clés n'a aucune conséquence à l'affichage.
 */
function canonique(valeur) {
  if (valeur === null || typeof valeur !== 'object') return JSON.stringify(valeur);
  if (Array.isArray(valeur)) return '[' + valeur.map(canonique).join(',') + ']';
  return '{' + Object.keys(valeur).sort()
    .map(cle => JSON.stringify(cle) + ':' + canonique(valeur[cle])).join(',') + '}';
}

// Projection d'essai : la forme compte, pas le contenu.
function projection(suffixe = '') {
  return {
    role: 'mj',
    id: 'map_test',
    nom: 'Carte',
    grid: { cols: 10, rows: 10, cellSize: 40 },
    tokens: { t1: { id: 't1', x: 1, y: 1 } },
    elements: { e1: { id: 'e1', x: 2, y: 2, nom: 'Mur' + suffixe } },
    annotations: {},
    fog: { enabled: true, mode: 'vision' },
    playerVision: { visible: ['1,1'], explored: [] },
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

// ---------------------------------------------------------------------
// Empreintes
// ---------------------------------------------------------------------

const a = allegement.empreintes(projection());
const b = allegement.empreintes(projection());
assert(JSON.stringify(a) === JSON.stringify(b),
  'Un contenu identique doit donner des empreintes identiques.');

const c = allegement.empreintes(projection('!'));
assert(a.elements !== c.elements, 'Un décor modifié doit changer son empreinte.');
assert(a.fog === c.fog, 'Un champ non modifié ne doit pas changer d\'empreinte.');

assert(!('tokens' in a),
  'tokens ne doit pas être empreint : il change à chaque mutation et pèse peu.');
assert(Object.keys(allegement.empreintes(null)).length === 0,
  'Une projection nulle ne produit aucune empreinte.');

// Un champ absent n'est pas empreint : le déclarer « inchangé » ferait
// conserver au client une valeur qu'il n'a jamais reçue.
const partielle = { id: 'map_test', elements: {} };
assert(!('fog' in allegement.empreintes(partielle)),
  'Un champ absent ne doit pas être empreint.');

// ---------------------------------------------------------------------
// Allègement
// ---------------------------------------------------------------------

// Premier envoi : rien à comparer, tout part.
const premier = allegement.alleger(projection(), null);
assert(premier.payload.reprises === undefined, 'Le premier envoi doit être complet.');
assert(premier.payload.elements, 'Le premier envoi doit contenir le décor.');

// Second envoi sans changement : les champs lourds disparaissent.
const second = allegement.alleger(projection(), premier.empreintes);
// Une projection MJ ne porte pas 'vision' (c'est le champ du joueur) :
// on n'exige que les champs réellement présents. Un champ absent ne doit
// surtout pas être annoncé comme « repris ».
allegement.CHAMPS_LOURDS
  .filter(champ => projection()[champ] !== undefined)
  .forEach(champ => {
    assert(second.payload[champ] === undefined,
      `${champ} identique aurait dû être retiré.`);
    assert(second.payload.reprises.includes(champ),
      `${champ} retiré doit figurer dans reprises.`);
  });
assert(!second.payload.reprises.includes('vision'),
  'Un champ absent de la projection ne doit jamais être annoncé comme repris.');
assert(second.payload.tokens, 'tokens ne doit JAMAIS être retiré.');
assert(second.payload.id === 'map_test' && second.payload.nom === 'Carte',
  'Les champs légers doivent toujours accompagner l\'envoi.');

// La fusion doit reconstituer EXACTEMENT la projection complète.
const complet = projection();
const fusionne = { ...second.payload };
fusionne.reprises.forEach(champ => { fusionne[champ] = complet[champ]; });
delete fusionne.reprises;
assert(canonique(fusionne) === canonique(complet),
  'L\'état fusionné doit être identique à la projection complète.');

// Un seul champ change : lui seul revient.
const modifie = allegement.alleger(projection('!'), premier.empreintes);
assert(modifie.payload.elements, 'Le décor modifié doit être renvoyé.');
assert(!modifie.payload.reprises.includes('elements'),
  'Un champ renvoyé ne doit pas figurer dans reprises.');
assert(modifie.payload.reprises.includes('fog'),
  'Les champs inchangés doivent rester repris.');

// Le gain doit être réel, pas théorique.
const gain = 1 - JSON.stringify(second.payload).length / JSON.stringify(complet).length;
assert(gain > 0.3, `L'allègement doit réduire sensiblement la charge (mesuré ${Math.round(gain * 100)} %).`);

// ---------------------------------------------------------------------
// Le piège : la projection d'un joueur change SANS que le décor change.
//
// projectionJoueur ne transmet que les éléments connus, et bascule le
// drapeau `remembered` selon ce qu'il voit à l'instant. Un simple numéro
// de version du décor conclurait « rien n'a changé » et priverait le
// joueur de ce qu'il vient de découvrir.
// ---------------------------------------------------------------------

const avantPas = {
  id: 'map_test', role: 'player', tokens: {},
  elements: { e1: { id: 'e1', nom: 'Mur', remembered: true } },
  vision: { visible: ['1,1'], explored: ['1,1'] }
};
const apresPas = {
  id: 'map_test', role: 'player', tokens: {},
  elements: { e1: { id: 'e1', nom: 'Mur', remembered: false } },
  vision: { visible: ['1,1', '2,1'], explored: ['1,1'] }
};

const pas1 = allegement.alleger(avantPas, null);
const pas2 = allegement.alleger(apresPas, pas1.empreintes);
assert(pas2.payload.elements,
  'Le décor CONNU du joueur a changé : il doit être renvoyé, même si aucun élément n\'a bougé.');
assert(pas2.payload.vision, 'La vision du joueur a changé : elle doit être renvoyée.');

// ---------------------------------------------------------------------
// Assertions statiques : les portes de sortie du serveur.
//
// Sans elles, un client incapable de fusionner redemanderait un état
// allégé, indéfiniment. Ce sont les deux lignes les plus faciles à
// perdre lors d'une refonte de emitMapState.
// ---------------------------------------------------------------------

const serveur = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const posteRequest = serveur.indexOf("socket.on('mapRequest'");
assert(posteRequest !== -1, 'mapRequest introuvable.');
assert(serveur.slice(posteRequest, posteRequest + 500).includes('socket.data.allegement = null'),
  'mapRequest doit effacer les empreintes : c\'est l\'échappatoire du client.');

const posteSync = serveur.indexOf("socket.emit('stateSync', snapshot)");
assert(posteSync !== -1, 'stateSync introuvable.');
assert(serveur.slice(Math.max(0, posteSync - 400), posteSync).includes('socket.data.allegement = null'),
  'stateSync doit repartir d\'un état complet.');

const coeur = fs.readFileSync(path.join(__dirname, '..', 'website', 'map-core.js'), 'utf8');
assert(coeur.includes('map.reprises.forEach'), 'La fusion est absente du moteur de rendu.');
assert(/if \(!ancien \|\| ancien\.id !== map\.id\) return false;/.test(coeur),
  'Le moteur doit refuser de fusionner une projection d\'une autre carte.');

['map.html', 'map_joueur.html'].forEach(page => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'website', page), 'utf8');
  assert(/if \(!renderer\.setMap\([^)]*\)\) \{[\s\S]{0,120}mapRequest/.test(source),
    `${page} doit redemander un état complet quand la fusion échoue.`);
});

console.log('PASS: V1.13.11 allègement — empreintes par champ, fusion fidèle, portes de sortie');
