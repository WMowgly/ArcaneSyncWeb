// allegement.js
// ---------------------------------------------------------------------------
// ArcaneSync V1.13.11 — N'envoyer que ce qui a changé.
//
// POURQUOI CE MODULE
// ------------------
// Chaque mutation — un point de vie, un déplacement — renvoyait la projection
// ENTIÈRE à tous les clients. Mesuré sur les cartes réelles :
//
//     Forêt — GERRX8 (309 éléments)   MJ 88,6 Ko   joueur 53,6 Ko
//     Bâtiment / Donjon (128)         MJ 38,6 Ko   joueur 13,3 Ko
//
// dont environ 85 % de décor qui n'avait pas bougé d'un pixel. Avec cinq
// postes, un seul point de dégâts faisait passer ~300 Ko sur le réseau.
//
// Ce n'est PAS un problème de processeur : la sérialisation d'une projection
// coûte 0,25 ms. C'est le réseau — et les postes en Wi-Fi — qui souffrent.
//
// LE PIÈGE ÉVITÉ
// --------------
// Un simple « numéro de version du décor » serait FAUX pour un joueur : son
// ensemble d'éléments GRANDIT à mesure qu'il explore (projectionJoueur ne
// transmet que ce qu'il connaît, et bascule le drapeau `remembered`). Le
// décor n'a pas changé, sa projection si.
//
// La seule référence sûre est donc le CONTENU RÉELLEMENT ENVOYÉ à ce
// destinataire-là. D'où une empreinte par champ, comparée au dernier envoi.
//
// CE MODULE EST PUR
// -----------------
// Aucun état, aucune socket, aucune écriture. Il vit à part de server.js
// parce que server.js ouvre un port dès qu'on le charge : rien de ce qu'il
// contient n'est atteignable depuis une suite de tests. Même raison que pour
// storage.js en V1.13.5.
// ---------------------------------------------------------------------------

const crypto = require('crypto');

// Les champs volumineux, et eux seuls.
//
// `tokens` en est volontairement ABSENT : il pèse moins de 2 Ko et c'est
// précisément ce qui change à chaque mutation. L'empreindre coûterait à
// chaque envoi pour ne rien économiser.
const CHAMPS_LOURDS = Object.freeze([
  'elements',
  'vision',
  'playerVision',
  'fog',
  'annotations'
]);

function empreinte(valeur) {
  return crypto.createHash('sha1')
    .update(JSON.stringify(valeur === undefined ? null : valeur))
    .digest('base64')
    .slice(0, 16);
}

/**
 * Empreintes des champs lourds d'une projection.
 * Un champ absent de la projection n'est pas empreint : il n'y a rien à
 * comparer, et le déclarer « inchangé » ferait croire au client qu'il doit
 * conserver une valeur qu'il n'a jamais reçue.
 */
function empreintes(projection) {
  const sortie = {};
  if (!projection) return sortie;

  CHAMPS_LOURDS.forEach(champ => {
    if (projection[champ] === undefined) return;
    sortie[champ] = empreinte(projection[champ]);
  });

  return sortie;
}

/**
 * Retire d'une projection les champs lourds identiques au dernier envoi.
 *
 * Retourne { payload, empreintes } :
 *   - payload    copie de surface, privée des champs inchangés, portant
 *                `reprises` : les noms que le client doit conserver ;
 *   - empreintes à mémoriser pour le prochain envoi à ce destinataire.
 *
 * Sans empreintes précédentes, la projection part ENTIÈRE. C'est le cas
 * d'une nouvelle connexion, d'un changement de carte, et de toute demande
 * explicite de resynchronisation.
 */
function alleger(projection, precedentes) {
  const courantes = empreintes(projection);
  if (!projection) return { payload: projection, empreintes: courantes };

  if (!precedentes) return { payload: projection, empreintes: courantes };

  const payload = { ...projection };
  const reprises = [];

  CHAMPS_LOURDS.forEach(champ => {
    if (courantes[champ] === undefined) return;
    if (precedentes[champ] !== courantes[champ]) return;
    delete payload[champ];
    reprises.push(champ);
  });

  if (reprises.length) payload.reprises = reprises;
  return { payload, empreintes: courantes };
}

module.exports = {
  CHAMPS_LOURDS,
  empreinte,
  empreintes,
  alleger
};
