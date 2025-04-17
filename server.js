const express = require('express');
const app = express();
const port = 3000;
const os = require('os');
const path = require('path');
const { ajouterJoueur, getJoueurs } = require('./joueur'); // <-- Import

const interfaceName = 'Ethernet 5';

// Middleware pour lire du JSON
app.use(express.json());

// Sert les fichiers statiques dans le dossier "website"
app.use(express.static('website'));

// API pour ajouter un joueur
app.post('/api/joueurs', (req, res) => {
  try {
    const nouveauJoueur = req.body;
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

// Adresse IP
function getIPAddress(interfaceName) {
  const interfaces = os.networkInterfaces();
  if (interfaces[interfaceName]) {
    for (const iface of interfaces[interfaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

const ip = getIPAddress(interfaceName);

app.listen(port, ip, () => {
  console.log(`Serveur en ligne : http://${ip}:${port}`);
});
