// storage.js
// ---------------------------------------------------------------------------
// ArcaneSync V1.13.5 — Persistance JSON : écriture atomique et vidage différé.
//
// POURQUOI CE MODULE
// ------------------
// 1. Le motif « écrire un .tmp puis renommer » était dupliqué à l'identique
//    dans joueur.js, session.js, mob.js et map.js. Une seule implémentation
//    suffit.
//
// 2. maps.json approche le mégaoctet. Chaque déplacement de token le
//    réécrivait INTÉGRALEMENT et de façon SYNCHRONE : ~59 ms mesurés, pendant
//    lesquels la boucle d'événements ne servait plus aucune requête. Un
//    glisser traversant dix cases bloquait donc le serveur près de 600 ms.
//
// CONTRAT DE COHÉRENCE
// --------------------
// Le vidage différé ne rend PAS les mutations asynchrones. Les modules
// appelants continuent de muter leur état mémoire de façon strictement
// synchrone ; seule l'écriture disque est repoussée et fusionnée. L'état
// mémoire reste la source de vérité — c'est déjà le modèle du serveur
// autoritaire — et deux requêtes ne peuvent pas s'entrelacer.
//
// Une écriture différée en attente est toujours vidée :
//   - au bout de `delaiMs` ;
//   - sur appel explicite de flush() ;
//   - à l'arrêt du processus (exit, SIGINT, SIGTERM).
// ---------------------------------------------------------------------------

const fs = require('fs');

const depots = new Map();
let arretInstalle = false;

/**
 * Dépôt d'écriture pour un fichier. Deux appels sur le même chemin
 * renvoient le même dépôt : recharger un module ne perd pas l'écriture
 * en attente.
 */
function creerDepot(cheminFichier, options = {}) {
  if (depots.has(cheminFichier)) {
    const existant = depots.get(cheminFichier);
    // Un module rechargé (tests, outillage) doit pouvoir reprendre la
    // main sur la notification : sinon le rappel resterait lié à la
    // PREMIÈRE instance, et la nouvelle ne saurait rien de ses propres
    // écritures.
    if (options.apresEcriture) existant.surEcriture(options.apresEcriture);
    return existant;
  }

  const delaiMs = Number.isFinite(options.delaiMs) ? options.delaiMs : 250;
  const etiquette = options.etiquette || cheminFichier;

  let apresEcriture = typeof options.apresEcriture === 'function' ? options.apresEcriture : null;
  let contenuEnAttente = null;
  let minuteur = null;

  function ecrireMaintenant(contenu) {
    const fichierTemporaire = `${cheminFichier}.tmp`;

    try {
      fs.writeFileSync(fichierTemporaire, contenu, 'utf-8');
      fs.renameSync(fichierTemporaire, cheminFichier);
      // Le module propriétaire doit pouvoir prendre acte de SA propre
      // écriture, sinon il la confondrait avec une modification externe.
      if (apresEcriture) apresEcriture();
      return true;
    } catch (erreur) {
      console.error(`Erreur lors de l'écriture de ${etiquette}:`, erreur);
      try {
        if (fs.existsSync(fichierTemporaire)) fs.unlinkSync(fichierTemporaire);
      } catch (erreurNettoyage) {
        console.error('Erreur lors du nettoyage du fichier temporaire:', erreurNettoyage);
      }
      return false;
    }
  }

  function annulerMinuteur() {
    if (!minuteur) return;
    clearTimeout(minuteur);
    minuteur = null;
  }

  const depot = {
    /** Écriture immédiate et atomique. Comportement historique. */
    ecrire(contenu) {
      // Une écriture immédiate rend caduque toute version en attente.
      contenuEnAttente = null;
      annulerMinuteur();
      return ecrireMaintenant(contenu);
    },

    /**
     * Écriture différée. Le contenu en attente est REMPLACÉ, jamais
     * empilé : dix mutations rapprochées produisent une seule écriture.
     *
     * `contenu` accepte une FONCTION `() => string`, évaluée seulement au
     * moment du vidage. C'est important : sérialiser un mégaoctet à chaque
     * mutation pour ne l'écrire qu'une fois reviendrait à ne différer que
     * la moitié du coût.
     */
    ecrireDifferee(contenu) {
      contenuEnAttente = contenu;

      if (!minuteur) {
        minuteur = setTimeout(() => {
          minuteur = null;
          depot.flush();
        }, delaiMs);

        // Une écriture en attente ne doit pas maintenir le processus en
        // vie : le gestionnaire d'arrêt s'en charge de toute façon.
        if (typeof minuteur.unref === 'function') minuteur.unref();
      }

      return true;
    },

    /** Force l'écriture en attente. Sans attente : succès immédiat. */
    flush() {
      annulerMinuteur();
      if (contenuEnAttente === null) return true;

      const enAttente = contenuEnAttente;
      contenuEnAttente = null;

      // Sérialisation paresseuse : une seule fois, ici.
      const contenu = typeof enAttente === 'function' ? enAttente() : enAttente;

      if (ecrireMaintenant(contenu)) return true;

      // Échec disque : on conserve le contenu pour la tentative suivante.
      contenuEnAttente = enAttente;
      return false;
    },

    /**
     * Abandonne l'écriture en attente sans l'appliquer.
     *
     * Indispensable dès qu'un tiers réécrit le fichier DIRECTEMENT, hors
     * du dépôt : sans cela, le vidage à l'arrêt ressusciterait l'ancien
     * contenu par-dessus. C'est le cas des tests, qui restaurent leurs
     * fichiers de données eux-mêmes.
     */
    annuler() {
      annulerMinuteur();
      contenuEnAttente = null;
    },

    /** Rebranche la notification d ecriture (module recharge). */
    surEcriture(fonction) {
      apresEcriture = typeof fonction === 'function' ? fonction : null;
    },

    enAttente() {
      return contenuEnAttente !== null;
    }
  };

  depots.set(cheminFichier, depot);
  installerArret();
  return depot;
}

// ---------------------------------------------------------------------------
// SAUVEGARDES TOURNANTES
//
// maps.json a été entièrement vidé une fois, sans que l'incident ait pu être
// reproduit. Le garde-fou d'obsolescence de map.js bloque le mécanisme le
// plus probable, mais il ne couvre pas ce qu'on n'a pas su expliquer. Une
// rotation au démarrage rend toute perte RÉVERSIBLE, pour un coût minime.
//
// Deux détails font la différence :
//   - on ne tourne PAS si la dernière sauvegarde est identique au fichier :
//     redémarrer dix fois de suite ne consomme pas les dix générations ;
//   - un fichier corrompu n'occupe donc qu'un seul emplacement au lieu
//     d'évincer toutes les bonnes versions au fil des redémarrages.
// ---------------------------------------------------------------------------

const path = require('path');

// ---------------------------------------------------------------------------
// V1.13.9 — Emplacement des fichiers de donnees.
//
// Les chemins etaient figes sur __dirname dans quatre modules. Une suite de
// tests ecrivait donc DANS LA PARTIE EN COURS, et ne s'en protegeait que par
// une sauvegarde/restauration en finally. Ce filet a cede deux fois : une
// session remplacee par un test d'import, et une carte de test ressuscitee
// par le vidage a l'arret.
//
// ARCANESYNC_DATA_DIR deplace TOUTES les donnees d'un coup. Defaut inchange :
// la racine du projet. Les sauvegardes tournantes suivent automatiquement,
// puisqu'elles se deduisent du dossier du fichier.
//
// La variable est lue au CHARGEMENT des modules appelants : elle doit donc
// etre posee avant tout require. C'est ce que fait tests/_donnees.js.
// ---------------------------------------------------------------------------

function dossierDonnees() {
  const perso = process.env.ARCANESYNC_DATA_DIR;
  if (!perso) return __dirname;
  if (!fs.existsSync(perso)) fs.mkdirSync(perso, { recursive: true });
  return perso;
}

function cheminDonnees(...segments) {
  return path.join(dossierDonnees(), ...segments);
}

/**
 * Fait tourner les sauvegardes d'un fichier de données.
 * Retourne true si une nouvelle génération a été créée.
 */
function sauvegarderRotation(cheminFichier, options = {}) {
  const generations = Math.max(1, Number(options.generations) || 5);
  const dossier = options.dossier
    || path.join(path.dirname(cheminFichier), 'sauvegardes');

  try {
    if (!fs.existsSync(cheminFichier)) return false;

    const contenu = fs.readFileSync(cheminFichier, 'utf-8');
    // Un fichier vide n'a rien à sauvegarder — et surtout, il ne doit pas
    // chasser une génération valable.
    if (!contenu.trim()) return false;

    if (!fs.existsSync(dossier)) fs.mkdirSync(dossier, { recursive: true });

    const base = path.join(dossier, path.basename(cheminFichier));
    const generation = rang => `${base}.${rang}`;

    // Rien de neuf depuis la dernière sauvegarde : on ne tourne pas.
    if (fs.existsSync(generation(1))) {
      try {
        if (fs.readFileSync(generation(1), 'utf-8') === contenu) return false;
      } catch (erreur) {
        // Sauvegarde illisible : on la remplacera, c'est le but.
      }
    }

    // La plus ancienne disparaît, les autres reculent d'un cran.
    try {
      if (fs.existsSync(generation(generations))) fs.unlinkSync(generation(generations));
    } catch (erreur) {
      console.error('Sauvegarde : impossible de retirer la plus ancienne génération:', erreur);
    }

    for (let rang = generations - 1; rang >= 1; rang -= 1) {
      if (fs.existsSync(generation(rang))) {
        fs.renameSync(generation(rang), generation(rang + 1));
      }
    }

    fs.writeFileSync(generation(1), contenu, 'utf-8');
    return true;
  } catch (erreur) {
    // Une sauvegarde qui échoue ne doit jamais empêcher le serveur de démarrer.
    console.error(`Sauvegarde impossible pour ${cheminFichier}:`, erreur);
    return false;
  }
}

/** Fait tourner les sauvegardes de plusieurs fichiers. Retourne le compte. */
function sauvegarderFichiers(chemins, options = {}) {
  return (chemins || []).reduce(
    (total, chemin) => total + (sauvegarderRotation(chemin, options) ? 1 : 0),
    0
  );
}

/** Vide tous les dépôts. Utilisé à l'arrêt et par les tests. */
function flushAll() {
  let succes = true;
  depots.forEach(depot => {
    if (!depot.flush()) succes = false;
  });
  return succes;
}

/**
 * Abandonne toutes les écritures en attente.
 * À appeler avant de restaurer un fichier de données à la main.
 */
function annulerTout() {
  depots.forEach(depot => depot.annuler());
}

function installerArret() {
  if (arretInstalle) return;
  arretInstalle = true;

  // 'exit' n'accepte que du synchrone : flushAll() l'est.
  process.on('exit', () => { flushAll(); });

  ['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal, () => {
      flushAll();
      process.exit(0);
    });
  });
}

module.exports = {
  creerDepot,
  dossierDonnees,
  cheminDonnees,
  flushAll,
  annulerTout,
  sauvegarderRotation,
  sauvegarderFichiers
};
