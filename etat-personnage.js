// etat-personnage.js
// ---------------------------------------------------------------------------
// Valeurs numériques d'un personnage : une seule définition, partagée par la
// fiche (joueur.js) et la partie (session.js).
//
// POURQUOI
// --------
// Le serveur recopiait ces champs tels qu'il les recevait. L'intoxication
// était ainsi enregistrée tantôt en texte ("20", pages joueur), tantôt en
// nombre (éditeur MJ), et un PV maximum non numérique restait tel quel.
//
// RÈGLES
// ------
//   - ressources {current, max} (PV, mana, durabilité, protection) : nombres,
//     0 <= current <= max ;
//   - vie bonus : nombre >= 0 ;
//   - intoxication : nombre >= 0, au plus la Constitution du personnage
//     (« Intox : x / Constitution ») ; une Constitution de 0 ne borne pas ;
//   - statistiques et niveau : nombres.
// Les anciennes valeurs en texte ("20") sont converties à l'enregistrement.
//
// Module PUR : aucune lecture ni écriture de fichier.
// ---------------------------------------------------------------------------

/** Nombre fini, ou `defaut` si la valeur n'en est pas un. */
function nombre(valeur, defaut = 0) {
  if (valeur === null || valeur === undefined || valeur === '') return defaut;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : defaut;
}

/**
 * Ressource {current, max} : nombres, la valeur actuelle ne descend pas sous
 * 0 et ne dépasse jamais le maximum. Les champs absents sont laissés absents.
 */
function bornerRessource(ressource) {
  const borne = { ...ressource };
  if (borne.max !== undefined) borne.max = Math.max(0, nombre(borne.max));
  if (borne.current !== undefined) {
    const actuel = Math.max(0, nombre(borne.current));
    borne.current = borne.max !== undefined ? Math.min(actuel, borne.max) : actuel;
  }
  return borne;
}

/** Intoxication : nombre >= 0, bornée par la Constitution quand elle est positive. */
function bornerIntox(intox, constitution) {
  const valeur = Math.max(0, nombre(intox));
  const plafond = nombre(constitution);
  return plafond > 0 ? Math.min(valeur, plafond) : valeur;
}

function normaliserStats(stats) {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return stats;
  return Object.fromEntries(Object.entries(stats).map(([cle, valeur]) => [cle, nombre(valeur)]));
}

/**
 * Applique les règles ci-dessus aux champs PRÉSENTS d'un personnage (fiche
 * ou état de partie). Renvoie une copie ; les autres champs sont inchangés.
 */
function normaliserValeursPersonnage(personnage) {
  if (!personnage || typeof personnage !== 'object') return personnage;
  const resultat = { ...personnage };

  if (resultat.stats !== undefined) resultat.stats = normaliserStats(resultat.stats);
  if (resultat.niveau !== undefined) resultat.niveau = nombre(resultat.niveau, 1);
  if (resultat.hp && typeof resultat.hp === 'object') resultat.hp = bornerRessource(resultat.hp);
  if (resultat.mana && typeof resultat.mana === 'object') resultat.mana = bornerRessource(resultat.mana);
  if (resultat.armure && typeof resultat.armure === 'object') {
    resultat.armure = { ...resultat.armure };
    ['durabilite', 'protection'].forEach(cle => {
      if (resultat.armure[cle] && typeof resultat.armure[cle] === 'object') {
        resultat.armure[cle] = bornerRessource(resultat.armure[cle]);
      }
    });
  }
  if (resultat.bonus_vie !== undefined) resultat.bonus_vie = Math.max(0, nombre(resultat.bonus_vie));
  if (resultat.intox !== undefined) resultat.intox = bornerIntox(resultat.intox, resultat.stats?.constitution);

  return resultat;
}

module.exports = { nombre, bornerRessource, bornerIntox, normaliserValeursPersonnage };
