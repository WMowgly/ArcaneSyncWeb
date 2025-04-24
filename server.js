const express = require('express');
const app = express();
const port = 3000;
const os = require('os');
const path = require('path');
const { ajouterJoueur, getJoueurs, supprimerJoueur } = require('./joueur'); // <-- Import

// Middleware pour lire du JSON
app.use(express.json());

// Sert les fichiers statiques dans le dossier "website"
app.use(express.static('website'));

// API pour ajouter un joueur
app.post('/api/joueurs', (req, res) => {
  try {
    const nouveauJoueur = req.body;
    if (!nouveauJoueur.nom) {
      return res.status(400).json({ message: "Le nom est requis." });
    }
    ajouterJoueur(nouveauJoueur);
    res.status(201).json({ message: 'Joueur enregistré avec succès !' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de l\'enregistrement.' });
  }
});

// (optionnel) API pour récupérer les joueurs
app.get('/api/joueurs', (req, res) => {
  res.json(getJoueurs());
});

app.delete('/api/joueurs/delete/:nom', (req, res) => {
  const nom = req.params.nom;
  console.log("Suppression du joueur :", nom);
  const success = supprimerJoueur(nom);
  if (success) {
    res.status(200).send(`Joueur ${nom} supprimé`);
  } else {
    res.status(404).send(`Joueur ${nom} non trouvé`);
  }
});

app.listen(port, () => {
  console.log(`Serveur en ligne : http://localhost:${port}`);
});
