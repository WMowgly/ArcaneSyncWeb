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
function supprimerJoueur(joueur) {
  const index = joueurs.findIndex(j => j.joueur === joueur);
  console.log("supprimerJoueur debug :", joueurs); // Debug
  if (index !== -1) {
    joueurs.splice(index, 1);
    fs.writeFileSync(cheminFichier, JSON.stringify(joueurs, null, 2));
    console.log("Joueurs restants :", joueurs); // Debug
    return true;
  }
  return false;
}

module.exports = { ajouterJoueur, getJoueurs, supprimerJoueur };
