// server.js
// ---------------------------------------------------------------------------
// Démarrage d'ArcaneSync : Express, Socket.IO et échanges temps réel.
//
// Les routes HTTP sont regroupées par domaine dans serveur/ :
//   routes-mj (code MJ), routes-joueurs, routes-session, routes-mobs,
//   routes-reference (données de jeu), routes-cartes, routes-initiative ;
//   acces.js (rôle MJ d'une requête), diffusion-carte.js (carte active).
// ---------------------------------------------------------------------------
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server);
const fs = require('fs');
const mapStore = require('./map');
const mjCode = require('./mjcode');
const tableau = require('./tableau');
const fsPromises = require('fs').promises;
const os = require('os');
const {
  sauvegarderFichiers,
  cheminDonnees
} = require('./storage');
const {
  getJoueurs,
  getJoueurById
} = require('./joueur');
const {
  getSessionPlayerById,
  ensureSessionPlayer,
  getSessionMobs,
  getPublicNotes,
  getSceneState,
  ensureSceneState,
  moveSceneToken,
  setMobSceneVisibility,
  getActiveMapId,
  getEcranVue
} = require('./session');
const diffusionCarte = require('./serveur/diffusion-carte');
const { getActiveMapForViewer, emitMapState } = diffusionCarte;

diffusionCarte.attacherIo(io);

// Configuration pour le tableau
const JSON_FILE = cheminDonnees('tableau.json');
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

// Routes HTTP, regroupées par domaine dans serveur/ (V1.16).
app.use(require('./serveur/routes-mj')(io));
app.use(require('./serveur/routes-joueurs')(io));
app.use(require('./serveur/routes-session')(io));
app.use(require('./serveur/routes-mobs')(io));
app.use(require('./serveur/routes-reference')(io));
app.use(require('./serveur/routes-cartes')(io));
app.use(require('./serveur/routes-initiative')(io));

// ------------------------------------------------------------------
// V1.12 — Reconnexion & resynchronisation de l'état autoritaire
// ------------------------------------------------------------------
// Le serveur reste la source de vérité. Lors d'une connexion/reconnexion,
// le client demande un snapshot limité à son rôle, puis recharge son UI
// depuis cet état officiel.
// ------------------------------------------------------------------
function buildAuthoritativeSocketSnapshot(role, playerId) {
  try {
    getJoueurs().forEach(joueur => ensureSessionPlayer(joueur));
    ensureSceneState();

    const normalizedRole = role === 'mj' ? 'mj' : 'player';

    if (normalizedRole === 'mj') {
      const players = getJoueurs().map(joueur => {
        const sessionPlayer = getSessionPlayerById(joueur.id) || ensureSessionPlayer(joueur);
        return {
          ...joueur,
          ...sessionPlayer,
          id: joueur.id,
          nom: sessionPlayer.nom ?? joueur.nom,
          classe: sessionPlayer.classe ?? joueur.classe,
          race: sessionPlayer.race ?? joueur.race,
          niveau: sessionPlayer.niveau ?? joueur.niveau,
          stats: sessionPlayer.stats ?? joueur.stats
        };
      });

      return {
        role: 'mj',
        serverTime: new Date().toISOString(),
        players,
        mobs: getSessionMobs(),
        publicNotes: getPublicNotes(),
        scene: getSceneState('mj'),
        // V1.13 : la carte est resynchronisée par le même mécanisme.
        activeMapId: getActiveMapId(),
        maps: mapStore.getMaps(),
        map: getActiveMapForViewer('mj', null)
      };
    }

    if (!playerId || !getJoueurById(playerId)) {
      return {
        role: 'player',
        serverTime: new Date().toISOString(),
        player: null,
        publicNotes: getPublicNotes(),
        scene: getSceneState('player', null),
        map: getActiveMapForViewer('player', null)
      };
    }

    return {
      role: 'player',
      playerId,
      serverTime: new Date().toISOString(),
      player: getSessionPlayerById(playerId) || ensureSessionPlayer(getJoueurById(playerId)),
      publicNotes: getPublicNotes(),
      scene: getSceneState('player', playerId),
      // Projection filtrée : ni tokens masqués, ni notes MJ, ni cases
      // hors du champ de vision du personnage.
      map: getActiveMapForViewer('player', playerId)
    };
  } catch (error) {
    console.error('Erreur création snapshot de resynchronisation:', error);
    return null;
  }
}

function sendAuthoritativeSocketSnapshot(socket) {
  const role = socket.handshake.query?.role;
  const playerId = socket.handshake.query?.playerId;
  const snapshot = buildAuthoritativeSocketSnapshot(role, playerId);

  if (!snapshot) {
    socket.emit('stateSyncError', {
      message: "Impossible de récupérer l'état autoritaire du serveur."
    });
    return;
  }

  // V1.13.11 — Le snapshot porte sa propre copie complète de la carte, et
  // les deux pages peuvent l'écarter (rôle ou personnage différent). On ne
  // suppose donc rien de ce que le client en retient.
  socket.data.allegement = null;
  socket.emit('stateSync', snapshot);
}

// Le rôle MJ d'un socket exige le code MJ, transmis à la connexion
// (auth.mjCode). Sans lui, le socket est traité comme un joueur : tous les
// gestionnaires lisent handshake.query.role, la correction vaut partout.
io.use((socket, next) => {
  const query = socket.handshake.query || {};
  if (query.role === 'mj' && !mjCode.autorise(socket.handshake.auth?.mjCode)) {
    query.role = 'player';
  }
  next();
});

// Gestionnaire de connexion WebSocket
io.on('connection', (socket) => {
  console.log('Client connecté', socket.id);

  // V1.12 : chaque connexion reçoit immédiatement l'état autoritaire
  // correspondant à son rôle.
  sendAuthoritativeSocketSnapshot(socket);

  // V1.13 : les pages de carte reçoivent aussi leur projection dédiée
  // dès la connexion, sans avoir à la demander.
  try {
    emitMapState(socket);
  } catch (error) {
    console.error('Erreur lors de l\'envoi initial de la carte:', error);
  }

  // Le client peut redemander explicitement un snapshot après une
  // reconnexion, une perte réseau ou toute autre resynchronisation.
  socket.on('stateSyncRequest', () => {
    sendAuthoritativeSocketSnapshot(socket);
  });

  // Vue de l'Écran partagé : envoyée à la connexion, puis à chaque choix du MJ.
  socket.emit('ecranVue', { vue: getEcranVue() });

  // Rooms privées joueur <-> MJ pour les notes personnelles.
  const privateRole = socket.handshake.query?.role;
  const privatePlayerId = socket.handshake.query?.playerId;

  if(privateRole === 'mj') {
    socket.join('private-mj');
  } else if(privateRole === 'player' && privatePlayerId) {
    socket.join(`private-player:${privatePlayerId}`);
  }

  // État de la scène : chaque déplacement est validé côté serveur.
  socket.on('sceneMoveToken', ({tokenId,x,y}) => {
    const role=socket.handshake.query?.role;
    const playerId=socket.handshake.query?.playerId;
    const result=moveSceneToken(tokenId,x,y,role,playerId);
    if(!result.success){
      socket.emit('sceneMoveRejected',{message:result.message});
      return;
    }
    socket.broadcast.emit('sceneUpdated');
  });

  socket.on('sceneRequest', () => {
    try {
      getJoueurs().forEach(joueur => ensureSessionPlayer(joueur));
      socket.emit('sceneUpdated');
    } catch(error) {
      socket.emit('sceneMoveRejected',{message:'Impossible de charger la scène.'});
    }
  });

  // ----------------------------------------------------------------
  // V1.13 — Carte : déplacement autoritaire des tokens.
  //
  // Le déplacement passe par Socket.IO plutôt que par REST car il est
  // fréquent et doit être immédiat. Le contrôle des droits reste
  // strictement côté serveur (map.deplacerToken).
  // ----------------------------------------------------------------
  socket.on('mapRequest', () => {
    try {
      // V1.13.11 — Une demande explicite exige un état COMPLET : c'est
      // l'échappatoire d'un client qui n'a pas pu fusionner. Oublier cette
      // ligne enfermerait ce client dans une boucle de demandes.
      socket.data.allegement = null;
      emitMapState(socket);
    } catch (error) {
      console.error('Erreur lors de l\'envoi de la carte:', error);
      socket.emit('mapActionRejected', { message: 'Impossible de charger la carte.' });
    }
  });

  // V1.13.12 — Ouvrir ou fermer une porte, joueur compris.
  //
  // Passe par la socket et non par une route REST, comme le déplacement de
  // jeton : le rôle et le personnage sont lus dans le HANDSHAKE, jamais
  // dans le message. Un client ne peut donc pas s'annoncer autrement qu'il
  // ne s'est connecté. Toute la décision est prise par map.basculerPorte().
  socket.on('mapTogglePorte', ({ elementId } = {}) => {
    const role = socket.handshake.query?.role === 'mj' ? 'mj' : 'player';
    const playerId = socket.handshake.query?.playerId || null;
    const mapId = getActiveMapId();

    if (!mapId) {
      socket.emit('mapActionRejected', { message: 'Aucune carte active.' });
      return;
    }

    const result = mapStore.basculerPorte(mapId, elementId, { role, playerId });

    if (!result.success) {
      socket.emit('mapActionRejected', { message: result.message });
      return;
    }

    // Ouvrir une porte dégage une ligne de vue : l'exploration doit être
    // recalculée AVANT diffusion, sinon la pièce révélée n'entrerait dans
    // la mémoire du groupe qu'au mouvement suivant.
    mapStore.rafraichirExploration(mapId);
    emitMapState();
  });

  socket.on('mapMoveToken', ({ tokenId, x, y } = {}) => {
    const role = socket.handshake.query?.role === 'mj' ? 'mj' : 'player';
    const playerId = socket.handshake.query?.playerId || null;
    const mapId = getActiveMapId();

    if (!mapId) {
      socket.emit('mapActionRejected', { message: 'Aucune carte active.' });
      return;
    }

    const result = mapStore.deplacerToken(mapId, tokenId, x, y, { role, playerId });

    if (!result.success) {
      if (result.unchanged) return;
      socket.emit('mapActionRejected', { message: result.message });
      // Le client a une position erronée : on lui renvoie la vérité.
      emitMapState(socket);
      return;
    }

    // Déplacer un personnage peut révéler de nouvelles zones.
    mapStore.rafraichirExploration(mapId);

    // Diffusion à tous, chacun avec sa propre projection : un joueur qui
    // sort du champ de vision d'un autre disparaît réellement de sa vue.
    emitMapState();
  });

  // ----------------------------------------------------------------
  // V1.13.2 — Aperçu en direct d'un tracé d'annotation.
  //
  // Repris du tableau blanc V1.10 (événement `draw`), mais :
  //   - aucune écriture disque : c'est un simple aperçu ;
  //   - le segment n'est relayé qu'aux clients autorisés à le voir ;
  //   - le tracé définitif est enregistré via POST au relâchement.
  // ----------------------------------------------------------------
  socket.on('mapDrawStream', ({ points, color, size, visibleToPlayers, strokeId } = {}) => {
    const role = socket.handshake.query?.role === 'mj' ? 'mj' : 'player';
    const playerId = socket.handshake.query?.playerId || null;
    const mapId = getActiveMapId();

    if (!mapId) return;
    if (!Array.isArray(points) || points.length < 2) return;

    const carte = mapStore.getMapById(mapId);
    if (!carte) return;

    // Un joueur ne peut prévisualiser que si le MJ l'a autorisé.
    if (role !== 'mj') {
      if (!carte.drawing.playersAllowed || !playerId) return;
    }

    const partage = role === 'mj' ? visibleToPlayers !== false : true;

    const apercu = {
      strokeId: strokeId || `${socket.id}:live`,
      author: role === 'mj' ? 'mj' : playerId,
      points,
      color,
      size,
      shared: partage
    };

    const autorisations = new Map();

    io.sockets.sockets.forEach(destinataire => {
      if (destinataire.id === socket.id) return;

      const roleCible = destinataire.handshake.query?.role === 'mj' ? 'mj' : 'player';
      // L'écran partagé connaît ce que le groupe connaît.
      const joueurCible = destinataire.handshake.query?.role === 'ecran'
        ? mapStore.VUE_GROUPE
        : destinataire.handshake.query?.playerId || null;

      // Le MJ voit tout, y compris les tracés en cours des joueurs.
      if (roleCible === 'mj') {
        destinataire.emit('mapDrawPreview', apercu);
        return;
      }

      if (!partage) return;                       // calque MJ : jamais relayé
      if (joueurCible === apercu.author) return;  // il dessine déjà chez lui

      // Le brouillard s'applique aussi à l'aperçu : dessiner ne doit pas
      // révéler la forme d'un couloir que le personnage n'a pas exploré.
      const cle = joueurCible || '-';
      if (!autorisations.has(cle)) {
        autorisations.set(cle, mapStore.segmentAutorisePour(mapId, joueurCible, points));
      }
      if (autorisations.get(cle)) destinataire.emit('mapDrawPreview', apercu);
    });
  });

  socket.on('sceneSetMobVisibility', ({mobId,visible}) => {
    if(socket.handshake.query?.role !== 'mj') {
      socket.emit('sceneMoveRejected',{message:'Seul le MJ peut modifier la visibilité des mobs.'});
      return;
    }

    const result=setMobSceneVisibility(mobId,visible);
    if(!result.success) {
      socket.emit('sceneMoveRejected',{message:result.message});
      return;
    }

    io.emit('sceneUpdated');
    emitMapState();
  });

  // Événement de dessin
  // Segments du trait en cours : diffusion en direct seulement. Le trait
  // complet est enregistré à la fin du geste (tableauTrait).
  socket.on('draw', data => socket.broadcast.emit('draw', data));

  // Dessins enregistrés (tableau.js) : un écran ouvert en cours de séance
  // retrouve tout ce qui a déjà été tracé.
  socket.on('tableauTracesRequest', () => {
    socket.emit('tableauTraces', { traces: tableau.getTraces() });
  });

  socket.on('tableauTrait', trait => {
    const enregistre = tableau.ajouterTrait(trait);
    if (enregistre) socket.broadcast.emit('tableauTrait', enregistre);
  });

  // Événement d'écriture
  socket.on('text', data => {
    const enregistre = tableau.ajouterTexte(data);
    if (enregistre) socket.broadcast.emit('text', enregistre);
  });

  socket.on('clearDrawings', () => {
    // Effacer le tableau pour toute la table : réservé au MJ.
    if (socket.handshake.query?.role !== 'mj') return;
    tableau.vider();
    io.emit('clearDrawings');
  });

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

// ------------------------------------------------------------------
// V1.13.7 — Sauvegardes tournantes au démarrage.
//
// Une perte complète de maps.json a été constatée sans avoir pu être
// reproduite. Les garde-fous en place bloquent le mécanisme le plus
// probable ; ces sauvegardes couvrent le reste, en rendant toute perte
// future réversible. Cinq générations dans sauvegardes/, et aucune
// rotation quand rien n'a changé depuis la dernière.
// ------------------------------------------------------------------
function sauvegarderDonnees() {
  const fichiers = ['data.json', 'session.json', 'maps.json', 'mob_templates.json', 'tableau_dessins.json']
    .map(nom => cheminDonnees(nom))
    // La référence des sorts, éditable par le MJ : sauvegardes dans database/sauvegardes/.
    .concat(cheminDonnees('database', 'sorts.json'));

  try {
    const nombre = sauvegarderFichiers(fichiers, { generations: 5 });
    console.log('\x1b[36m%s\x1b[0m',
      `[Sauvegarde] ${nombre} fichier(s) de données archivé(s) dans sauvegardes/.`);
  } catch (erreur) {
    // Une sauvegarde ratée ne doit jamais empêcher la partie de commencer.
    console.error('[Sauvegarde] Rotation impossible :', erreur);
  }
}

sauvegarderDonnees();

// Le port reste 3000 par defaut : rien ne change pour la partie. La
// variable PORT permet de lancer une seconde instance a cote de celle du
// MJ — pour un controle de bout en bout sans couper une partie en cours.
const PORT = Number(process.env.PORT) || 3000;

initializeDocumentData().then(() => {
  const ip = getLocalIPAddress();
  server.listen(PORT, () => {
    console.log('\x1b[36m%s\x1b[0m', '[Serveur Principal] En ligne : http://' + ip + ':' + PORT);
    if (!mjCode.estConfigure()) {
      console.log('[Code MJ] Aucun code MJ : il sera demandé à la première ouverture d\'une page MJ.');
    }
  });
});