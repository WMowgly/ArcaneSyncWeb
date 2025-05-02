const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server);
const path = require('path');
const fs = require('fs');
const { ajouterJoueur, getJoueurs, supprimerJoueur, sauvegardeData } = require('./joueur');

// Configuration pour le tableau
const JSON_FILE = path.join(__dirname, 'tableau.json');
let documentData = {
    content: "",
    lastSaved: null,
    users: {}
};

// Charger les données du tableau
try {
  if (fs.existsSync(JSON_FILE)) {
      documentData = JSON.parse(fs.readFileSync(JSON_FILE));
      if (!documentData.users) {
          documentData.users = {};
      }
  }
} catch (err) {
  console.error('Erreur lors du chargement du document:', err);
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
  console.log('Client connecté', socket.id);

  // Envoyer immédiatement le contenu actuel
  socket.emit('documentData', {
    content: documentData.content,
    lastSaved: documentData.lastSaved
  });

  // Gérer l'arrivée d'un participant
  socket.on('joinDocument', ({ clientId }) => {
    console.log('Client rejoint le document:', clientId);
      
    documentData.users[clientId] = {
      id: clientId,
      socketId: socket.id,
      connectedAt: new Date().toISOString()
    };
      
    io.emit('usersUpdate', documentData.users);
  });

  // Mise à jour de contenu
  socket.on('contentUpdate', ({ content, timestamp, clientId }) => {
    if (content !== documentData.content) {
      documentData.content = content;
      
      // Diffuser à tous les clients sauf l'émetteur
      socket.broadcast.emit('documentData', {
          content: documentData.content,
          timestamp: timestamp,
          clientId: clientId
      });
    }
  });

  // Mouvement de curseur
  socket.on('cursorMove', ({ clientId, range }) => {
    socket.broadcast.emit('cursorUpdate', {
      clientId: clientId,
      range: range
    });
  });

  // Sauvegarde du document
  socket.on('saveDocument', ({ content }) => {
    documentData.content = content;
    documentData.lastSaved = new Date().toISOString();
      
    // Sauvegarder dans le fichier
    fs.writeFileSync(JSON_FILE, JSON.stringify(documentData, null, 2));
      
    // Émettre à tous les clients
    io.emit('documentData', {
        content: documentData.content,
        lastSaved: documentData.lastSaved
    });
      
    console.log('Document sauvegardé:', new Date().toISOString());
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

server.listen(3000, () => {
  console.log('\x1b[36m%s\x1b[0m', '[Serveur Principal] En ligne : http://192.168.1.162:3000');
});