const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server);
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const { ajouterJoueur, getJoueurs, supprimerJoueur, sauvegardeData } = require('./joueur');

// Configuration pour le tableau
const JSON_FILE = path.join(__dirname, 'tableau.json');
let documentData = {
    content: "",
    lastSaved: null,
    users: {}
};

// Charger les données du tableau
async function initializeDocumentData() {
  try {
    if (fs.existsSync(JSON_FILE)) {
      const fileContent = await fsPromises.readFile(JSON_FILE, 'utf8');
      documentData = JSON.parse(fileContent);
      if (!documentData.users) {
        documentData.users = {};
      }
    }
  } catch (err) {
    console.error('Erreur lors du chargement du document:', err);
  }
}

// Middleware
app.use(express.json());
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
  console.log("Mise à jour du joueur :", req.body);
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

// Ajouter cette route pour accéder à la base de données
app.get('/api/game-database', (req, res) => {
  try {
    const databasePath = path.join(__dirname, 'database', 'game_database.json');
    fs.readFile(databasePath, 'utf8', (err, data) => {
      if (err) {
        console.error('Erreur lors de la lecture de la base de données:', err);
        return res.status(500).json({ error: 'Erreur lors de la lecture de la base de données' });
      }
      try {
        const jsonData = JSON.parse(data);
        res.json(jsonData);
      } catch (parseError) {
        console.error('Erreur lors du parsing JSON:', parseError);
        res.status(500).json({ error: 'Erreur lors du parsing des données' });
      }
    });
  } catch (error) {
    console.error('Erreur lors de l\'accès au fichier:', error);
    res.status(500).json({ error: 'Erreur lors de l\'accès au fichier' });
  }
});

// Gestionnaire de connexion WebSocket
io.on('connection', (socket) => {
  console.log('Client connecté', socket.id);

  // Événement de dessin
  socket.on('draw', data => socket.broadcast.emit('draw', data));

  // Événement d'écriture
  socket.on('text', data => socket.broadcast.emit('text', data));
  
  // Mouvement de curseur
  socket.on('cursorMove', ({ clientId, range }) => {
    socket.broadcast.emit('cursorUpdate', {
      clientId: clientId,
      range: range
    });
  });

  // Sauvegarde du document
  socket.on('saveDocument', async ({ content }) => {
    documentData.content = content;
    documentData.lastSaved = new Date().toISOString();
      
    try {
      await fsPromises.writeFile(JSON_FILE, JSON.stringify(documentData, null, 2));
      io.emit('documentData', {
        content: documentData.content,
        lastSaved: documentData.lastSaved
      });
      console.log('Document sauvegardé:', new Date().toISOString());
    } catch (err) {
      console.error('Erreur lors de la sauvegarde:', err);
    }
  });

  socket.on('loadDocument', () => {
      socket.emit('documentData', documentData);
  });

  // Quitter le document
  socket.on('leave', ({ clientId }) => {
    console.log('Client quitte le document:', clientId);
    
    if (documentData.users[clientId]) {
      delete documentData.users[clientId];
      io.emit('usersUpdate', documentData.users);
    }
  });

  // Déconnexion du client
  socket.on('disconnect', () => {
    console.log('Client déconnecté:', socket.id);
    
    // Rechercher et supprimer l'utilisateur avec ce socketId
    const clientId = Object.keys(documentData.users).find(
      key => documentData.users[key].socketId === socket.id
    );
    
    if (clientId) {
      delete documentData.users[clientId];
      io.emit('usersUpdate', documentData.users);
    }
  });
});

function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  for (let name in interfaces) {
    for (let iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

initializeDocumentData().then(() => {
  const ip = getLocalIPAddress();
  server.listen(3000, () => {
    console.log('\x1b[36m%s\x1b[0m', '[Serveur Principal] En ligne : http://' + ip + ':3000');
  });
});