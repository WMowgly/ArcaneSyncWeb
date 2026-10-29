// serveur/routes-session.js
// ---------------------------------------------------------------------------
// Partie active (session.json) : état des personnages, notes, Écran, scène,
// repos, export / import.
//
// Routes déplacées telles quelles depuis server.js (V1.16). Le routeur est
// nommé `app` pour que chaque route garde exactement son écriture d'origine.
// ---------------------------------------------------------------------------
const express = require('express');
const {
  getJoueurs,
  getJoueurById,
  sauvegardeData
} = require('../joueur');
const {
  getSession,
  getSessionPlayerById,
  ensureSessionPlayer,
  sauvegarderEtatSession,
  getDonneesPersonnageDepuisSession,
  importerSession,
  validerSessionImport,
  getPlayerPersonalNotes,
  setPlayerPersonalNotes,
  getPublicNotes,
  savePublicNote,
  deletePublicNote,
  getSceneState,
  ensureSceneState,
  resetScenePositions,
  setMobSceneVisibility,
  getEcranVue,
  setEcranVue,
  getReglesRepos,
  setReglesRepos,
  appliquerRepos
} = require('../session');
const { roleDepuisRequete, refuserSiPasMj, sansDonneesPrivees } = require('./acces');
const { emitMapState } = require('./diffusion-carte');

const app = express.Router();
let io = null;

// ------------------------------------------------------------------
// API de session de jeu
//
// IMPORTANT : cette API ne modifie JAMAIS data.json.
// Elle manipule uniquement l'état de la partie active.
// ------------------------------------------------------------------

// État des personnages enrichi avec la partie active.
app.get('/api/session/players', (req, res) => {
  try {
    const joueurs = getJoueurs();
    const result = joueurs.map((joueur) => {
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
    res.json(result.map(sansDonneesPrivees));
  } catch (error) {
    console.error("Erreur lors de la récupération des joueurs de session:", error);
    res.status(500).json({ message: "Impossible de charger l'état actif des joueurs." });
  }
});

app.get('/api/session/player/:id', (req, res) => {
  const joueur = getJoueurById(req.params.id);

  if (!joueur) {
    return res.status(404).json({ message: 'Joueur non trouvé.' });
  }

  try {
    const joueurSession = getSessionPlayerById(req.params.id)
      || ensureSessionPlayer(joueur);

    res.json(sansDonneesPrivees(joueurSession));
  } catch (error) {
    console.error("Erreur lors de l'initialisation de la session:", error);
    res.status(500).json({
      message: "Impossible de charger l'état de session."
    });
  }
});


// Import MANUEL de l'état courant de la partie vers la Fiche de Perso.
// Ce transfert n'est jamais déclenché automatiquement.

// ------------------------------------------------------------------
// Export / import de la partie active.
// Ces routes manipulent uniquement session.json.
// Elles permettent de déplacer une partie active vers un autre serveur.
// ------------------------------------------------------------------


// ------------------------------------------------------------------
// NOTES — trois espaces distincts
// ------------------------------------------------------------------
function accessAllowed(req, playerId) {
  const role=req.query?.role || req.body?.role;
  const requestedPlayerId=req.query?.playerId || req.body?.playerId;
  return roleDepuisRequete(req)==='mj' || (role==='player' && requestedPlayerId===playerId);
}

function personalNotesWriteAllowed(req, playerId) {
  const role=req.body?.role;
  const requestedPlayerId=req.body?.playerId;
  // Les notes personnelles appartiennent au joueur : seul lui peut les modifier.
  return role==='player' && requestedPlayerId===playerId;
}

// 1) Notes personnelles du joueur : joueur + MJ, mais pas les autres joueurs.
app.get('/api/session/player/:id/personal-notes',(req,res)=>{
  if(!getJoueurById(req.params.id)) return res.status(404).json({message:'Joueur non trouvé.'});
  if(!accessAllowed(req,req.params.id)) return res.status(403).json({message:'Accès aux notes personnelles refusé.'});
  res.json({playerId:req.params.id,content:getPlayerPersonalNotes(req.params.id)});
});

app.put('/api/session/player/:id/personal-notes',(req,res)=>{
  if(!getJoueurById(req.params.id)) return res.status(404).json({message:'Joueur non trouvé.'});
  if(!personalNotesWriteAllowed(req,req.params.id)) {
    return res.status(403).json({message:'Seul le joueur concerné peut modifier ses notes personnelles.'});
  }

  const result=setPlayerPersonalNotes(req.params.id,req.body?.content);
  if(!result.success) return res.status(400).json({message:result.message});

  if(!sauvegardeData({id:req.params.id},{personalNotes:result.content})) {
    return res.status(500).json({message:'Notes sauvegardées dans la session mais pas dans le personnage.'});
  }

  io.to(`private-player:${req.params.id}`).emit('personalNotesUpdated',{playerId:req.params.id});
  io.to('private-mj').emit('personalNotesUpdated',{playerId:req.params.id});
  res.json({message:'Notes personnelles sauvegardées.',playerId:req.params.id,content:result.content});
});

// 2) Notes publiques du MJ.
// (Les messages privés joueur <-> MJ ont été retirés : les anciens
// privateMessages restent dans les fichiers mais ne sont plus lus.)
app.get('/api/session/public-notes',(req,res)=>{
  res.json({notes:getPublicNotes()});
});

app.post('/api/session/public-notes',(req,res)=>{
  if (refuserSiPasMj(req, res)) return;
  const result=savePublicNote({title:req.body?.title,content:req.body?.content});
  if(!result.success) return res.status(400).json({message:result.message});
  io.emit('publicNotesUpdated');
  res.status(201).json({message:'Note publique créée.',note:result.note,notes:result.notes});
});

app.put('/api/session/public-notes/:id',(req,res)=>{
  if (refuserSiPasMj(req, res)) return;
  const result=savePublicNote({id:req.params.id,title:req.body?.title,content:req.body?.content});
  if(!result.success) return res.status(400).json({message:result.message});
  io.emit('publicNotesUpdated');
  res.json({message:'Note publique modifiée.',note:result.note,notes:result.notes});
});

app.delete('/api/session/public-notes/:id',(req,res)=>{
  if (refuserSiPasMj(req, res)) return;
  const result=deletePublicNote(req.params.id);
  if(!result.success) return res.status(404).json({message:result.message});
  io.emit('publicNotesUpdated');
  res.json({message:'Note publique supprimée.',notes:result.notes});
});

// ------------------------------------------------------------------
// ÉCRAN PARTAGÉ : le MJ choisit ce qu'il affiche (carte ou tableau blanc).
// ------------------------------------------------------------------
app.get('/api/ecran', (req, res) => {
  res.json({ vue: getEcranVue() });
});

app.post('/api/ecran', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  const result = setEcranVue(req.body?.vue);
  if (!result.success) return res.status(400).json({ message: result.message });
  io.emit('ecranVue', { vue: result.vue });
  res.json({ vue: result.vue });
});

// ------------------------------------------------------------------
// TABLEAU / SCÈNE DE JEU V1.10
// ------------------------------------------------------------------
app.get('/api/session/scene', (req,res)=>{
  try {
    // Garantit que les personnages existants disposent d'un état de session
    // avant de construire leurs tokens.
    getJoueurs().forEach(joueur => ensureSessionPlayer(joueur));
    ensureSceneState();
    res.json(getSceneState(roleDepuisRequete(req), req.query?.playerId));
  } catch(error) {
    console.error('Erreur chargement scène:', error);
    res.status(500).json({message:'Impossible de charger la scène de jeu.'});
  }
});

app.post('/api/session/scene/mob/:id/toggle-visibility',(req,res)=>{
  if (refuserSiPasMj(req, res)) return;

  const scene=ensureSceneState();
  const token=scene.tokens[`mob:${req.params.id}`];
  if(!token) {
    return res.status(404).json({message:'Mob introuvable dans la scène.'});
  }

  // Le serveur décide lui-même du prochain état : cela évite toute
  // ambiguïté entre false, "false" et l'état affiché dans le navigateur.
  const nextVisible = token.visibleToPlayers === false;
  const result=setMobSceneVisibility(req.params.id,nextVisible);
  if(!result.success) {
    return res.status(500).json({message:result.message});
  }

  io.emit('sceneUpdated');
  emitMapState();
  res.json({
    message: nextVisible ? 'Mob rendu visible aux joueurs.' : 'Mob caché aux joueurs.',
    mobId:req.params.id,
    visibleToPlayers:nextVisible
  });
});

app.put('/api/session/scene/mob/:id/visibility',(req,res)=>{
  if (refuserSiPasMj(req, res)) return;

  // Important : Boolean("false") vaut true en JavaScript.
  // On accepte uniquement un vrai booléen pour éviter que "Montrer"
  // soit interprété comme "Cacher".
  if (typeof req.body?.visible !== 'boolean') {
    return res.status(400).json({message:'La valeur visible doit être un booléen.'});
  }
  const visible = req.body.visible;
  const result=setMobSceneVisibility(req.params.id,visible);
  if(!result.success) return res.status(404).json({message:result.message});

  io.emit('sceneUpdated');
  emitMapState();
  res.json({
    message: visible ? 'Mob rendu visible aux joueurs.' : 'Mob caché aux joueurs.',
    mobId:req.params.id,
    visibleToPlayers:visible
  });
});

app.post('/api/session/scene/reset',(req,res)=>{
  if (refuserSiPasMj(req, res)) return;
  const result=resetScenePositions();
  if(!result.success) return res.status(500).json({message:result.message});
  io.emit('sceneUpdated');
  emitMapState();
  res.json(result.scene);
});

app.get('/api/session/export', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  try {
    const session = getSession();

    const exportData = {
      format: 'ArcaneSyncSession',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      session
    };

    const filename = `arcanesync-session-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(JSON.stringify(exportData, null, 2));
  } catch (error) {
    console.error("Erreur lors de l'export de la session:", error);
    res.status(500).json({
      message: "Impossible d'exporter la session."
    });
  }
});

app.post('/api/session/import', (req, res) => {
  // V1.13.5 : cette route REMPLACE la partie active dans son intégralité.
  // C'est l'appel le plus destructeur de l'API : il exige le rôle MJ.
  if (refuserSiPasMj(req, res)) return;

  try {
    const payload = req.body;

    if (!payload || payload.format !== 'ArcaneSyncSession' || payload.formatVersion !== 1) {
      return res.status(400).json({
        message: "Fichier de session ArcaneSync invalide ou version non supportée."
      });
    }

    const nouvelleSession = payload.session;
    const validation = validerSessionImport(nouvelleSession);

    if (!validation.valid) {
      return res.status(400).json({
        message: validation.message
      });
    }

    // Un import doit correspondre aux personnages présents sur ce serveur.
    const joueursServeur = getJoueurs();
    const idsServeur = new Set(joueursServeur.map(joueur => joueur.id));

    const idsSession = Object.keys(nouvelleSession.players);
    const joueursInconnus = idsSession.filter(id => !idsServeur.has(id));

    if (joueursInconnus.length > 0) {
      return res.status(409).json({
        message: "La session contient des personnages absents de ce serveur.",
        unknownPlayerIds: joueursInconnus
      });
    }

    const result = importerSession(nouvelleSession);

    if (!result.success) {
      return res.status(500).json({
        message: result.message
      });
    }

    // Toutes les interfaces de jeu concernées doivent recharger leur état.
    for (const playerId of Object.keys(result.session.players)) {
      io.emit('sessionPlayerUpdate', {
        type: 'sessionImport',
        playerId,
        session: sansDonneesPrivees(result.session.players[playerId])
      });
    }

    io.emit('sessionUpdated', {
      type: 'sessionImport',
      sessionId: result.session.id,
      playerIds: Object.keys(result.session.players)
    });

    res.status(200).json({
      message: "Session importée avec succès.",
      sessionId: result.session.id,
      playerIds: Object.keys(result.session.players)
    });
  } catch (error) {
    console.error("Erreur lors de l'import de la session:", error);
    res.status(500).json({
      message: "Impossible d'importer la session."
    });
  }
});

app.post('/api/session/player/:id/apply-to-character', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  const id = req.params.id;
  const joueur = getJoueurById(id);

  if (!joueur) {
    return res.status(404).json({ message: "Personnage introuvable." });
  }

  const donneesSession = getDonneesPersonnageDepuisSession(id);

  if (!donneesSession) {
    return res.status(404).json({
      message: "Aucun état de session disponible pour ce personnage."
    });
  }

  const success = sauvegardeData({ id }, donneesSession);

  if (!success) {
    return res.status(500).json({
      message: "Impossible d'importer l'état de la partie dans la Fiche de Perso."
    });
  }

  const joueurMisAJour = getJoueurById(id);

  io.emit('playerUpdate', {
    type: 'manualSessionImport',
    player: joueurMisAJour.nom,
    playerId: id
  });

  res.status(200).json({
    message: `L'état actuel de la partie a été importé dans la Fiche de Perso de ${joueurMisAJour.nom}.`,
    playerId: id,
    player: sansDonneesPrivees(joueurMisAJour)
  });
});

// Champs qu'un joueur peut enregistrer sans code MJ.
const CHAMPS_ETAT_JEU = new Set(['hp', 'mana', 'armure', 'bonus_vie', 'intox', 'survie']);

app.post('/api/session/player', (req, res) => {
  const { id, nouvellesDonnees } = req.body;

  if (!id || !nouvellesDonnees) {
    return res.status(400).json({
      message: "L'identifiant du joueur et les données de session sont requis."
    });
  }

  // L'Interface de Jeu enregistre l'état de jeu du personnage ; tout le
  // reste (stats, inventaire, équipement...) passe par l'éditeur du MJ.
  const champsHorsJeu = Object.keys(nouvellesDonnees).filter(champ => !CHAMPS_ETAT_JEU.has(champ));
  if (champsHorsJeu.length && refuserSiPasMj(req, res)) return;

  const joueur = getJoueurById(id);

  if (!joueur) {
    return res.status(404).json({
      message: "Le personnage correspondant n'existe pas."
    });
  }

  // Si la session n'existe pas encore pour ce joueur, on l'initialise
  // depuis la fiche de personnage avant d'accepter la modification.
  try {
    ensureSessionPlayer(joueur);
  } catch (error) {
    console.error("Erreur lors de l'initialisation de session:", error);
    return res.status(500).json({
      message: "Impossible d'initialiser la session."
    });
  }

  if (nouvellesDonnees.stats !== undefined &&
      (typeof nouvellesDonnees.stats !== 'object' || Array.isArray(nouvellesDonnees.stats))) {
    return res.status(400).json({ message: 'Les statistiques du joueur sont invalides.' });
  }

  if (nouvellesDonnees.hp !== undefined &&
      (typeof nouvellesDonnees.hp !== 'object' || Array.isArray(nouvellesDonnees.hp))) {
    return res.status(400).json({ message: 'Les HP du joueur sont invalides.' });
  }

  if (nouvellesDonnees.mana !== undefined &&
      (typeof nouvellesDonnees.mana !== 'object' || Array.isArray(nouvellesDonnees.mana))) {
    return res.status(400).json({ message: 'Le Mana du joueur est invalide.' });
  }

  if (nouvellesDonnees.armure !== undefined &&
      (typeof nouvellesDonnees.armure !== 'object' || Array.isArray(nouvellesDonnees.armure))) {
    return res.status(400).json({ message: "L'armure du joueur est invalide." });
  }

  const success = sauvegarderEtatSession(id, nouvellesDonnees);

  if (!success) {
    return res.status(500).json({
      message: "Impossible de sauvegarder l'état de session."
    });
  }

  /*
   * Inventaire et équipement sont des données persistantes du personnage.
   * Le MJ les modifie depuis son éditeur de fiche : elles doivent donc
   * rester liées à data.json, tout en continuant à alimenter la session.
   *
   * Les ressources de combat (HP/Mana), elles, restent des données de
   * session et ne sont PAS écrites automatiquement dans la fiche.
   */
  const donneesPersistantesMJ = {};
  const champsInventaireEquipement = [
    'inventaire',
    'armes',
    'armure',
    'sac',
    'ceinture'
  ];

  champsInventaireEquipement.forEach(champ => {
    if (nouvellesDonnees[champ] !== undefined) {
      donneesPersistantesMJ[champ] = nouvellesDonnees[champ];
    }
  });

  if (Object.keys(donneesPersistantesMJ).length > 0) {
    const personnageMisAJour = sauvegardeData({ id }, donneesPersistantesMJ);

    if (!personnageMisAJour) {
      return res.status(500).json({
        message: "La session a été sauvegardée, mais l'inventaire/équipement n'a pas pu être enregistré dans la Fiche de Perso."
      });
    }

    /*
     * sauvegardeData() persiste uniquement le personnage.
     * La session déjà sauvegardée juste au-dessus reste donc la source
     * de vérité pour les ressources de la partie (HP/Mana/statuts).
     * L'inventaire et l'équipement sont désormais identiques dans les
     * deux représentations.
     */
  }

  const joueurSession = sansDonneesPrivees(getSessionPlayerById(id));

  // Événement spécifique à la session : la fiche de personnage
  // n'écoute volontairement PAS cet événement.
  // `source` : l'Interface de Jeu prévient le joueur quand le MJ modifie
  // son personnage (pas quand il le modifie lui-même).
  io.emit('sessionPlayerUpdate', {
    type: 'update',
    player: joueur.nom,
    playerId: id,
    session: joueurSession,
    source: roleDepuisRequete(req) === 'mj' ? 'mj' : 'joueur'
  });

  io.emit('sessionUpdated', {
    type: 'playerUpdate',
    playerId: id
  });

  io.emit('gmPlayerUpdated', {
    type: 'fullPlayerUpdate',
    playerId: id,
    session: joueurSession
  });

  // La carte affiche les HP et statuts en direct : elle doit suivre.
  emitMapState();

  res.status(200).json({
    message: `L'état de session de ${joueur.nom} a été sauvegardé.`,
    playerId: id,
    session: joueurSession
  });
});

// ------------------------------------------------------------------
// Repos court / long (MJ) : règles enregistrées dans la partie, puis
// appliquées aux personnages choisis. Voir repos.js.
// ------------------------------------------------------------------

app.get('/api/session/repos', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  res.json({ regles: getReglesRepos() });
});

app.put('/api/session/repos', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  const result = setReglesRepos(req.body?.regles);
  if (!result.success) return res.status(500).json({ message: result.message });
  res.json({ regles: result.repos });
});

app.post('/api/session/repos/:type', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  const { regles, joueurs } = req.body || {};
  if (regles) {
    const enregistrement = setReglesRepos(regles);
    if (!enregistrement.success) return res.status(500).json({ message: enregistrement.message });
  }

  const result = appliquerRepos(req.params.type, Array.isArray(joueurs) ? joueurs : undefined);
  if (!result.success && !result.resultats) return res.status(400).json({ message: result.message });

  for (const { id, nom } of result.resultats) {
    const joueurSession = sansDonneesPrivees(getSessionPlayerById(id));
    io.emit('sessionPlayerUpdate', {
      type: 'update', player: nom, playerId: id, session: joueurSession,
      source: 'repos', repos: req.params.type
    });
    io.emit('gmPlayerUpdated', { type: 'fullPlayerUpdate', playerId: id, session: joueurSession });
  }
  if (result.resultats.length) {
    io.emit('sessionUpdated', { type: 'repos', playerIds: result.resultats.map(r => r.id) });
    emitMapState();
  }

  if (!result.success) return res.status(500).json({ message: result.message, resultats: result.resultats });
  res.json({ type: result.type, resultats: result.resultats, regles: getReglesRepos() });
});

module.exports = instanceIo => {
  io = instanceIo;
  return app;
};
