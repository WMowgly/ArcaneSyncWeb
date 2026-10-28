// initiative.js
// ---------------------------------------------------------------------------
// Ordre d'initiative d'un combat : combattants triés par valeur, tour
// courant et numéro de round.
//
// Module PUR : il transforme un état et en renvoie un nouveau. La
// persistance est faite par session.js (champ `initiative` de la partie).
//
// État :
//   { actif, round, tour, entrees: [{ id, kind, entityId, nom, valeur, cache }] }
// `tour` est l'index, dans `entrees`, du combattant qui joue.
// `cache` (créatures seulement) : le MJ ne veut pas la révéler à la table ;
// elle est retirée de la projection envoyée à l'Écran et aux joueurs.
// ---------------------------------------------------------------------------

const ETAT_VIDE = Object.freeze({ actif: false, round: 1, tour: 0, entrees: [] });
const KINDS = ['player', 'mob'];

const entier = (valeur, defaut, min, max) => {
  const n = Math.round(Number(valeur));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : defaut;
};

function normaliserEntree(entree) {
  if (!entree || !KINDS.includes(entree.kind)) return null;
  const entityId = typeof entree.entityId === 'string' ? entree.entityId.trim().slice(0, 120) : '';
  if (!entityId) return null;
  return {
    id: `${entree.kind}:${entityId}`,
    kind: entree.kind,
    entityId,
    nom: (typeof entree.nom === 'string' && entree.nom.trim() ? entree.nom.trim() : entityId).slice(0, 80),
    valeur: entier(entree.valeur, 0, -99, 999),
    cache: entree.kind === 'mob' && entree.cache === true
  };
}

function normaliserEntrees(liste) {
  const vues = new Set();
  return (Array.isArray(liste) ? liste : [])
    .map(normaliserEntree)
    .filter(entree => entree && !vues.has(entree.id) && vues.add(entree.id));
}

/** État relu depuis le fichier : tout ce qui est incohérent est corrigé. */
function normaliserEtat(etat) {
  if (!etat || typeof etat !== 'object') return { ...ETAT_VIDE, entrees: [] };
  const entrees = normaliserEntrees(etat.entrees);
  return {
    actif: etat.actif === true && entrees.length > 0,
    round: entier(etat.round, 1, 1, 9999),
    tour: entrees.length ? entier(etat.tour, 0, 0, entrees.length - 1) : 0,
    entrees
  };
}

/**
 * Début du combat : tri par valeur décroissante (à égalité, l'ordre saisi).
 * `ordreManuel` : le MJ a rangé les combattants lui-même ; son ordre est gardé.
 */
function demarrer(entrees, { ordreManuel = false } = {}) {
  const liste = ordreManuel ? normaliserEntrees(entrees) : normaliserEntrees(entrees)
    .map((entree, rang) => ({ entree, rang }))
    .sort((a, b) => b.entree.valeur - a.entree.valeur || a.rang - b.rang)
    .map(({ entree }) => entree);
  if (!liste.length) return { success: false, message: 'Ajoutez au moins un combattant.' };
  return { success: true, etat: { actif: true, round: 1, tour: 0, entrees: liste } };
}

function suivant(etat) {
  if (!etat.actif) return { success: false, message: 'Aucun combat en cours.' };
  const fin = etat.tour + 1 >= etat.entrees.length;
  return { success: true, etat: { ...etat, tour: fin ? 0 : etat.tour + 1, round: fin ? etat.round + 1 : etat.round } };
}

function precedent(etat) {
  if (!etat.actif) return { success: false, message: 'Aucun combat en cours.' };
  if (etat.tour > 0) return { success: true, etat: { ...etat, tour: etat.tour - 1 } };
  if (etat.round > 1) return { success: true, etat: { ...etat, tour: etat.entrees.length - 1, round: etat.round - 1 } };
  return { success: true, etat };
}

/** Retire un combattant (mort, fuite) sans perdre le fil du tour. */
function retirer(etat, id) {
  const index = etat.entrees.findIndex(entree => entree.id === id);
  if (index === -1) return { success: false, message: 'Combattant introuvable.' };
  const entrees = etat.entrees.filter(entree => entree.id !== id);
  if (!entrees.length) return { success: true, etat: { ...ETAT_VIDE, entrees: [] } };
  let { tour, round } = etat;
  if (index < tour) tour -= 1;
  if (tour >= entrees.length) { tour = 0; round += 1; }
  return { success: true, etat: { ...etat, entrees, tour, round } };
}

/**
 * Ordre choisi à la main par le MJ : le combattant `id` passe à la place
 * `position` (0 = premier). Celui qui joue garde la main.
 */
function deplacer(etat, id, position) {
  const index = etat.entrees.findIndex(entree => entree.id === id);
  if (index === -1) return { success: false, message: 'Combattant introuvable.' };
  const cible = entier(position, index, 0, etat.entrees.length - 1);
  if (cible === index) return { success: true, etat };
  const courant = etat.entrees[etat.tour]?.id;
  const entrees = etat.entrees.slice();
  const [entree] = entrees.splice(index, 1);
  entrees.splice(cible, 0, entree);
  const tour = Math.max(0, entrees.findIndex(e => e.id === courant));
  return { success: true, etat: { ...etat, entrees, tour } };
}

/** Cache ou révèle une créature à la table. */
function basculerCache(etat, id) {
  const entrees = etat.entrees.map(entree =>
    (entree.id === id && entree.kind === 'mob' ? { ...entree, cache: !entree.cache } : entree));
  if (entrees.every((entree, i) => entree === etat.entrees[i])) {
    return { success: false, message: 'Seule une créature peut être cachée.' };
  }
  return { success: true, etat: { ...etat, entrees } };
}

/**
 * Ce que voit la table (Écran, joueurs) : les créatures cachées sont
 * retirées. `courant` est l'identifiant de celui qui joue, ou null quand
 * c'est une créature cachée.
 */
function projectionTable(etat) {
  const courant = etat.entrees[etat.tour];
  return {
    actif: etat.actif,
    round: etat.round,
    courant: etat.actif && courant && !courant.cache ? courant.id : null,
    entrees: etat.entrees.filter(entree => !entree.cache)
      .map(({ id, kind, nom }) => ({ id, kind, nom }))
  };
}

module.exports = {
  ETAT_VIDE,
  normaliserEtat,
  demarrer,
  suivant,
  precedent,
  retirer,
  deplacer,
  basculerCache,
  projectionTable
};
