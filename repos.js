// repos.js
// ---------------------------------------------------------------------------
// Repos court / long : ce que chaque repos rend au groupe.
//
// Module PUR : règles normalisées et calcul des nouvelles valeurs. La
// persistance des règles est faite par session.js (champ `repos` de la
// partie) ; l'application passe par sauvegarderEtatSession, qui borne déjà
// chaque valeur entre 0 et son maximum.
//
// Règles : { court: { hp, mana, protection }, long: { hp, mana, protection } }
// Chaque ressource : { mode, valeur }
//   aucun     rien n'est rendu ;
//   max       remise au maximum ;
//   pourcent  rend `valeur` % du maximum (arrondi au supérieur) ;
//   valeur    rend `valeur` points.
// ---------------------------------------------------------------------------

const TYPES = ['court', 'long'];
const RESSOURCES = ['hp', 'mana', 'protection'];
const MODES = ['aucun', 'max', 'pourcent', 'valeur'];

const REGLES_PAR_DEFAUT = {
  court: {
    hp: { mode: 'pourcent', valeur: 50 },
    mana: { mode: 'pourcent', valeur: 50 },
    protection: { mode: 'aucun', valeur: 0 }
  },
  long: {
    hp: { mode: 'max', valeur: 0 },
    mana: { mode: 'max', valeur: 0 },
    protection: { mode: 'max', valeur: 0 }
  }
};

function normaliserRegle(regle, defaut) {
  const mode = MODES.includes(regle?.mode) ? regle.mode : defaut.mode;
  const borne = mode === 'pourcent' ? 100 : 9999;
  const nombre = Math.round(Number(regle?.valeur));
  const valeur = Number.isFinite(nombre) ? Math.min(borne, Math.max(0, nombre)) : defaut.valeur;
  return { mode, valeur };
}

/** Règles complètes et valides : un champ absent ou invalide reprend sa valeur par défaut. */
function normaliserRegles(regles) {
  const resultat = {};
  for (const type of TYPES) {
    resultat[type] = {};
    for (const ressource of RESSOURCES) {
      resultat[type][ressource] = normaliserRegle(regles?.[type]?.[ressource], REGLES_PAR_DEFAUT[type][ressource]);
    }
  }
  return resultat;
}

function lireRessource(joueur, ressource) {
  const source = ressource === 'protection' ? joueur?.armure?.protection : joueur?.[ressource];
  const max = Math.max(0, Number(source?.max) || 0);
  const current = Math.min(max, Math.max(0, Number(source?.current) || 0));
  return { max, current };
}

function gain(regle, max) {
  if (regle.mode === 'max') return max;
  if (regle.mode === 'pourcent') return Math.ceil(max * regle.valeur / 100);
  if (regle.mode === 'valeur') return regle.valeur;
  return 0;
}

/**
 * Valeurs d'un personnage après le repos. `regle` : règles normalisées
 * d'un type de repos (normaliserRegles(...).court ou .long).
 * Renvoie { avant, apres, modifications } ; `modifications` est au format
 * de sauvegarderEtatSession et vaut null si rien ne change.
 */
function calculerRepos(joueur, regle) {
  const avant = {};
  const apres = {};
  const modifications = {};

  for (const ressource of RESSOURCES) {
    const { max, current } = lireRessource(joueur, ressource);
    avant[ressource] = current;
    apres[ressource] = Math.min(max, current + gain(regle[ressource], max));
    if (apres[ressource] === current) continue;
    if (ressource === 'protection') modifications.armure = { protection: { current: apres[ressource] } };
    else modifications[ressource] = { current: apres[ressource] };
  }

  return { avant, apres, modifications: Object.keys(modifications).length ? modifications : null };
}

module.exports = { TYPES, RESSOURCES, MODES, REGLES_PAR_DEFAUT, normaliserRegles, calculerRepos };
