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

module.exports = { ajouterJoueur, getJoueurs };
