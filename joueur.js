// joueur.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { creerDepot, cheminDonnees } = require('./storage');

const cheminFichier = cheminDonnees('data.json');
let joueurs = [];

function normaliserInventaire(inventaire) {
  if (!Array.isArray(inventaire)) return [];

  return inventaire
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      id: typeof item.id === 'string' && item.id ? item.id : genererIdJoueur(),
      nom: typeof item.nom === 'string' ? item.nom.trim() : '',
      type: typeof item.type === 'string' ? item.type : 'Objet',
      quantite: Math.max(1, Number.isFinite(Number(item.quantite)) ? Number(item.quantite) : 1),
      emplacement: typeof item.emplacement === 'string' ? item.emplacement : '',
      equipe: item.equipe === true,
      description: typeof item.description === 'string' ? item.description : ''
    }))
    .filter(item => item.nom.length > 0);
}

function genererIdJoueur() {
  return `char_${crypto.randomUUID().replace(/-/g, '')}`;
}

if (fs.existsSync(cheminFichier)) {
  try {
    const contenu = fs.readFileSync(cheminFichier, 'utf-8');
    joueurs = JSON.parse(contenu);

    if (!Array.isArray(joueurs)) {
      throw new Error('data.json doit contenir un tableau de joueurs.');
    }

    // Migration légère : les anciens personnages reçoivent un ID stable.
    let migrationNecessaire = false;
    const ids = new Set();

    joueurs = joueurs.map(joueur => {
      let id = joueur.id;

      if (!id || ids.has(id)) {
        id = genererIdJoueur();
        migrationNecessaire = true;
      }

      ids.add(id);
      const inventaire = normaliserInventaire(joueur.inventaire);
      if (JSON.stringify(inventaire) !== JSON.stringify(joueur.inventaire || [])) {
        migrationNecessaire = true;
      }

      return { ...joueur, id, inventaire };
    });

    if (migrationNecessaire) {
      if (!ecrireJoueurs(joueurs)) {
        console.error("Impossible de persister la migration des IDs de personnages.");
      } else {
        console.log("Migration des IDs de personnages effectuée.");
      }
    }
  } catch (err) {
    console.error("Erreur lors de la lecture des joueurs:", err);
  }
}

/**
 * Écrit les données de manière atomique : le fichier temporaire est terminé
 * avant de remplacer le fichier de données courant.
 */
// V1.13.5 : écriture atomique factorisée dans storage.js, sémantique
// synchrone inchangée — data.json est la persistance des fiches, elle ne
// doit jamais être différée.
const depotJoueurs = creerDepot(cheminFichier, { etiquette: 'data.json' });

function ecrireJoueurs(joueursAEnregistrer) {
  return depotJoueurs.ecrire(JSON.stringify(joueursAEnregistrer, null, 2));
}

function ajouterJoueur(joueur) {
  const joueurAvecId = {
    ...joueur,
    id: joueur.id || genererIdJoueur(),
    inventaire: normaliserInventaire(joueur.inventaire)
  };

  const nouveauxJoueurs = [...joueurs, joueurAvecId];

  if (!ecrireJoueurs(nouveauxJoueurs)) {
    throw new Error("Impossible de sauvegarder le nouveau joueur.");
  }

  joueurs = nouveauxJoueurs;
  return joueurAvecId;
}

function getJoueurs() {
  return joueurs;
}

function getJoueurById(id) {
  return joueurs.find(joueur => joueur.id === id) || null;
}

function trouverIndexJoueur({ id, nom }) {
  if (id) {
    const indexParId = joueurs.findIndex(joueur => joueur.id === id);
    if (indexParId !== -1) {
      return indexParId;
    }
  }

  if (nom) {
    return joueurs.findIndex(
      joueur => typeof joueur.nom === 'string' &&
        joueur.nom.toLowerCase() === nom.toLowerCase()
    );
  }

  return -1;
}

function supprimerJoueur({ id, nom }) {
  console.log(
    "Tentative de suppression du joueur :",
    id ? `id=${id}` : `nom=${nom}`
  );

  const index = trouverIndexJoueur({ id, nom });

  if (index === -1) {
    console.log("Aucun joueur trouvé.");
    return false;
  }

  const joueursMisAJour = joueurs.filter((_, joueurIndex) => joueurIndex !== index);

  if (!ecrireJoueurs(joueursMisAJour)) {
    return false;
  }

  joueurs = joueursMisAJour;
  return true;
}

function sauvegardeData({ id, nom }, nouvellesDonnees) {
  console.log(
    "Tentative de mise à jour du joueur :",
    id ? `id=${id}` : `nom=${nom}`
  );

  const index = trouverIndexJoueur({ id, nom });

  if (index === -1) {
    console.log("Aucun joueur trouvé.");
    return false;
  }

  const joueurActuel = joueurs[index];

  // L'ID existant est toujours conservé : le nom est une donnée modifiable,
  // l'ID est l'identité technique du personnage.
  const joueurMisAJour = {
    ...joueurActuel,
    ...nouvellesDonnees,
    id: joueurActuel.id,
    inventaire: nouvellesDonnees.inventaire !== undefined
      ? normaliserInventaire(nouvellesDonnees.inventaire)
      : normaliserInventaire(joueurActuel.inventaire),
    stats: {
      ...(joueurActuel.stats || {}),
      ...(nouvellesDonnees.stats || {})
    },
    hp: {
      ...(joueurActuel.hp || {}),
      ...(nouvellesDonnees.hp || {})
    },
    mana: {
      ...(joueurActuel.mana || {}),
      ...(nouvellesDonnees.mana || {})
    },
    armure: {
      ...(joueurActuel.armure || {}),
      ...(nouvellesDonnees.armure || {}),
      durabilite: {
        ...((joueurActuel.armure && joueurActuel.armure.durabilite) || {}),
        ...((nouvellesDonnees.armure && nouvellesDonnees.armure.durabilite) || {})
      },
      protection: {
        ...((joueurActuel.armure && joueurActuel.armure.protection) || {}),
        ...((nouvellesDonnees.armure && nouvellesDonnees.armure.protection) || {})
      }
    }
  };

  if (!joueurMisAJour.nom) {
    joueurMisAJour.nom = joueurActuel.nom;
  }

  const joueursMisAJour = [...joueurs];
  joueursMisAJour[index] = joueurMisAJour;

  if (!ecrireJoueurs(joueursMisAJour)) {
    return false;
  }

  joueurs = joueursMisAJour;
  console.log("Joueur mis à jour :", joueurs[index]);
  return true;
}

module.exports = {
  ajouterJoueur,
  getJoueurs,
  getJoueurById,
  supprimerJoueur,
  sauvegardeData,
  normaliserInventaire
};
