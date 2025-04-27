const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server);
const path = require('path');
const { ajouterJoueur, getJoueurs, supprimerJoueur, sauvegardeData } = require('./joueur');

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
    io.emit('playerUpdate', { type: 'add', player: nouveauJoueur.nom });
    res.status(201).json({ message: 'Joueur enregistré avec succès !' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de l\'enregistrement.' });
  }
});

// API pour récupérer les joueurs
app.get('/api/joueurs', (req, res) => {
  res.json(getJoueurs());
});

// API pour supprimer un joueur
app.delete('/api/joueurs/delete/:nom', (req, res) => {
  const nom = req.params.nom;
  console.log("Suppression du joueur :", nom);
  const success = supprimerJoueur(nom);
  if (success) {
    io.emit('playerUpdate', { type: 'delete', player: nom });
    res.status(200).send(`Joueur ${nom} supprimé`);
  } else {
    res.status(404).send(`Joueur ${nom} non trouvé`);
  }
});

// API pour mettre à jour un joueur
app.post('/api/joueur', (req, res) => {
  const { nom, nouvellesDonnees } = req.body;

  if (!nom || !nouvellesDonnees) {
    return res.status(400).json({ message: "Le nom et les nouvelles données sont requis." });
  }

  const success = sauvegardeData(nom, nouvellesDonnees);

  if (success) {
    console.log('Émission de l\'événement playerUpdate pour:', nom); // Ajoutez ce log
    io.emit('playerUpdate', { type: 'update', player: nom });
    res.status(200).json({ message: `Les données du joueur ${nom} ont été mises à jour avec succès.` });
  } else {
    res.status(404).json({ message: `Joueur ${nom} non trouvé.` });
  }
});

// Gestionnaire de connexion WebSocket
io.on('connection', (socket) => {
  console.log('Client connecté');
  socket.on('disconnect', () => {
    console.log('Client déconnecté');
  });
});

server.listen(3000, () => {
  console.log(`Serveur en ligne : http://192.168.1.162:3000`);
});