// joueur.js
const fs = require('fs');
const path = require('path');

const cheminFichier = path.join(__dirname, 'data.json');

// Initialisation des joueurs
let joueurs = [];

// Charger les joueurs déjà enregistrés
if (fs.existsSync(cheminFichier)) {
  try {
    const contenu = fs.readFileSync(cheminFichier, 'utf-8');
    joueurs = JSON.parse(contenu);
  } catch (err) {
    console.error("Erreur lors de la lecture des joueurs:", err);
  }
}

// Ajouter un joueur
function ajouterJoueur(joueur) {
  joueurs.push(joueur);
  fs.writeFileSync(cheminFichier, JSON.stringify(joueurs, null, 2));
}

// Récupérer les joueurs
function getJoueurs() {
  return joueurs;
}

// Supprimer un joueur
function supprimerJoueur(nom) {
  console.log("Tentative de suppression du joueur avec le nom :", nom); // Debug
  const index = joueurs.findIndex(j => j.nom.toLowerCase() === nom.toLowerCase()); // Comparaison insensible à la casse
  console.log("Index trouvé pour suppression :", index); // Debug
  if (index !== -1) {
    joueurs.splice(index, 1);
    try {
      fs.writeFileSync(cheminFichier, JSON.stringify(joueurs, null, 2));
      console.log("Joueurs restants après suppression :", joueurs); // Debug
    } catch (err) {
      console.error("Erreur lors de la sauvegarde après suppression:", err);
    }
    return true;
  }
  console.log("Aucun joueur trouvé avec le nom :", nom); // Debug
  return false;
}

// Sauvegarder les data de la fiche du joueur
function sauvegardeData(nom, nouvellesDonnees) {
  console.log("Tentative de mise à jour du joueur avec le nom :", nom); // Debug
  const index = joueurs.findIndex(j => j.nom.toLowerCase() === nom.toLowerCase()); // Comparaison insensible à la casse
  console.log("Index trouvé pour mise à jour :", index); // Debug
  if (index !== -1) {
    joueurs[index] = {
      ...joueurs[index],
      hp: {
        max: nouvellesDonnees.hp?.max ?? joueurs[index].hp?.max,
        current: nouvellesDonnees.hp?.current ?? joueurs[index].hp?.current
      },
      mana: {
        max: nouvellesDonnees.mana?.max ?? joueurs[index].mana?.max,
        current: nouvellesDonnees.mana?.current ?? joueurs[index].mana?.current
      },
      armure: {
        ...joueurs[index].armure,
        durabilite: {
          max: nouvellesDonnees.armure?.durabilite?.max ?? joueurs[index].armure?.durabilite?.max,
          current: nouvellesDonnees.armure?.durabilite?.current ?? joueurs[index].armure?.durabilite?.current
        },
        protection: {
          max: nouvellesDonnees.armure?.protection?.max ?? joueurs[index].armure?.protection?.max,
          current: nouvellesDonnees.armure?.protection?.current ?? joueurs[index].armure?.protection?.current
        }
      },
      bonus_vie: nouvellesDonnees.bonus_vie ?? joueurs[index].bonus_vie,
      intox: nouvellesDonnees.intox ?? joueurs[index].intox
    }; // Fusionner les données existantes avec les nouvelles
    try {
      fs.writeFileSync(cheminFichier, JSON.stringify(joueurs, null, 2));
      console.log("Joueur mis à jour :", joueurs[index]); // Debug
      return true;
    } catch (err) {
      console.error("Erreur lors de la sauvegarde après mise à jour:", err);
    }
  }
  console.log("Aucun joueur trouvé avec le nom :", nom); // Debug
  return false;
}


module.exports = { ajouterJoueur, getJoueurs, supprimerJoueur, sauvegardeData };
