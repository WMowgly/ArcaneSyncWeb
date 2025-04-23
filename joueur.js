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


module.exports = { ajouterJoueur, getJoueurs, supprimerJoueur };
