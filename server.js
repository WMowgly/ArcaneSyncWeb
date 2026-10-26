const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server);
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const {
  ajouterJoueur,
  getJoueurs,
  getJoueurById,
  supprimerJoueur,
  sauvegardeData
} = require('./joueur');

const {
  getSessionPlayerById,
  ensureSessionPlayer,
  synchroniserSessionDepuisPersonnage,
  sauvegarderEtatSession,
  getDonneesPersonnageDepuisSession,
  importerSession,
  validerSessionImport,
  getSessionMobs,
  getSessionMobById,
  sauvegarderMobSession,
  supprimerMobSession,
  getStatutsJoueurDisponibles,
  ajouterStatutJoueur,
  retirerStatutJoueur,
  ajouterStatutMob,
  retirerStatutMob,
  getPlayerPersonalNotes,
  setPlayerPersonalNotes,
  getPublicNotes,
  savePublicNote,
  deletePublicNote,
  getSceneState,
  ensureSceneState,
  moveSceneToken,
  resetScenePositions,
  setMobSceneVisibility,
  getActiveMapId,
  setActiveMapId
} = require('./session');

const mapStore = require('./map');
const mapGen = require('./mapgen');
const { sauvegarderFichiers, cheminDonnees } = require('./storage');
const allegement = require('./allegement');
const sortsRef = require('./sorts');
const { listesSortsReference } = sortsRef;

const {
  getMobTemplates,
  getMobTemplateById,
  createMobTemplate,
  updateMobTemplate,
  deleteMobTemplate,
  createMobFromTemplate,
  normaliserMob,
  nommerInstance,
  getCategoriesMob,
  duplicateMobTemplate,
  duplicateMob,
  templateDepuisMob
} = require('./mob');


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

// API pour ajouter un joueur
app.post('/api/joueurs', (req, res) => {
  try {
    const nouveauJoueur = req.body;
    if (!nouveauJoueur.nom) {
      return res.status(400).json({ message: "Le nom est requis." });
    }
    const joueurEnregistre = ajouterJoueur(nouveauJoueur);
    io.emit('playerUpdate', {
      type: 'add',
      player: joueurEnregistre.nom,
      playerId: joueurEnregistre.id
    });
    io.emit('sceneUpdated');
    emitMapState();
    res.status(201).json({
      message: 'Joueur enregistré avec succès !',
      playerId: joueurEnregistre.id
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de l\'enregistrement.' });
  }
});

// API pour récupérer les joueurs
app.get('/api/joueurs', (req, res) => {
  res.json(getJoueurs());
});

// API pour récupérer un joueur par son identifiant stable
app.get('/api/joueurs/:id', (req, res) => {
  const joueur = getJoueurById(req.params.id);

  if (!joueur) {
    return res.status(404).json({ message: 'Joueur non trouvé.' });
  }

  res.json(joueur);
});

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
    res.json(result);
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

    res.json(joueurSession);
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
  return role==='mj' || (role==='player' && requestedPlayerId===playerId);
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
  if(req.body?.role!=='mj') return res.status(403).json({message:'Seul le MJ peut modifier les notes publiques.'});
  const result=savePublicNote({title:req.body?.title,content:req.body?.content});
  if(!result.success) return res.status(400).json({message:result.message});
  io.emit('publicNotesUpdated');
  res.status(201).json({message:'Note publique créée.',note:result.note,notes:result.notes});
});

app.put('/api/session/public-notes/:id',(req,res)=>{
  if(req.body?.role!=='mj') return res.status(403).json({message:'Seul le MJ peut modifier les notes publiques.'});
  const result=savePublicNote({id:req.params.id,title:req.body?.title,content:req.body?.content});
  if(!result.success) return res.status(400).json({message:result.message});
  io.emit('publicNotesUpdated');
  res.json({message:'Note publique modifiée.',note:result.note,notes:result.notes});
});

app.delete('/api/session/public-notes/:id',(req,res)=>{
  if(req.body?.role!=='mj') return res.status(403).json({message:'Seul le MJ peut modifier les notes publiques.'});
  const result=deletePublicNote(req.params.id);
  if(!result.success) return res.status(404).json({message:result.message});
  io.emit('publicNotesUpdated');
  res.json({message:'Note publique supprimée.',notes:result.notes});
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
    res.json(getSceneState(req.query?.role, req.query?.playerId));
  } catch(error) {
    console.error('Erreur chargement scène:', error);
    res.status(500).json({message:'Impossible de charger la scène de jeu.'});
  }
});

app.post('/api/session/scene/mob/:id/toggle-visibility',(req,res)=>{
  if(req.body?.role!=='mj') {
    return res.status(403).json({message:'Seul le MJ peut modifier la visibilité des mobs.'});
  }

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
  if(req.body?.role!=='mj') {
    return res.status(403).json({message:'Seul le MJ peut modifier la visibilité des mobs.'});
  }

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
  if(req.body?.role!=='mj') {
    return res.status(403).json({message:'Seul le MJ peut réinitialiser la scène.'});
  }
  const result=resetScenePositions();
  if(!result.success) return res.status(500).json({message:result.message});
  io.emit('sceneUpdated');
  emitMapState();
  res.json(result.scene);
});

// STATUTS JOUEURS — gestion par le MJ.
// ------------------------------------------------------------------
app.get('/api/statuses',(req,res)=>res.json(getStatutsJoueurDisponibles()));

app.post('/api/session/player/:id/statuses',(req,res)=>{
  const result=ajouterStatutJoueur(req.params.id,req.body?.statutId);
  if(!result.success)return res.status(400).json({message:result.message});
  io.emit('sessionPlayerUpdate',{type:'statusUpdate',playerId:req.params.id,session:result.player});
  io.emit('playerStatusUpdated',{playerId:req.params.id,statuts:result.player.statuts});
  emitMapState();
  res.json({message:'Statut appliqué.',playerId:req.params.id,statuts:result.player.statuts});
});

app.delete('/api/session/player/:id/statuses/:statutId',(req,res)=>{
  const result=retirerStatutJoueur(req.params.id,req.params.statutId);
  if(!result.success)return res.status(400).json({message:result.message});
  io.emit('sessionPlayerUpdate',{type:'statusUpdate',playerId:req.params.id,session:result.player});
  io.emit('playerStatusUpdated',{playerId:req.params.id,statuts:result.player.statuts});
  emitMapState();
  res.json({message:'Statut retiré.',playerId:req.params.id,statuts:result.player.statuts});
});

// ------------------------------------------------------------------
// MOBS / NPC — gestion uniquement par le MJ.
// Aucun moteur de combat n'est exécuté par ArcaneSync.
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// V1.13.8 — Statuts des créatures.
//
// Calquées sur les routes de statuts joueur ci-dessus, et partageant le
// MÊME catalogue (STATUTS_JOUEUR) : Poison ou Paralysie s'appliquent
// aussi bien à un gobelin qu'à un personnage.
// ------------------------------------------------------------------
app.post('/api/mobs/:id/statuses', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  const result = ajouterStatutMob(req.params.id, req.body?.statutId);
  if (!result.success) return res.status(400).json({ message: result.message });

  io.emit('mobUpdated', { type: 'statusUpdate', mob: result.mob });
  emitMapState();
  res.json({ message: 'Statut appliqué.', mobId: req.params.id, statuts: result.mob.statuts });
});

app.delete('/api/mobs/:id/statuses/:statutId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  const result = retirerStatutMob(req.params.id, req.params.statutId);
  if (!result.success) return res.status(400).json({ message: result.message });

  io.emit('mobUpdated', { type: 'statusUpdate', mob: result.mob });
  emitMapState();
  res.json({ message: 'Statut retiré.', mobId: req.params.id, statuts: result.mob.statuts });
});

app.get('/api/mobs', (req, res) => {
  res.json(Object.values(getSessionMobs()));
});

app.post('/api/mobs', (req, res) => {
  try {
    if (!req.body?.nom || !String(req.body.nom).trim()) {
      return res.status(400).json({ message: 'Le nom du mob est requis.' });
    }
    const mob = normaliserMob(req.body);
    if (!sauvegarderMobSession(mob)) {
      return res.status(500).json({ message: 'Impossible de sauvegarder le mob.' });
    }
    io.emit('mobUpdated', { type: 'created', mob });
    io.emit('sceneUpdated');
    emitMapState();
    res.status(201).json({ message: 'Mob créé avec succès.', mob });
  } catch (error) {
    console.error('Erreur création mob:', error);
    res.status(500).json({ message: 'Impossible de créer le mob.' });
  }
});

app.put('/api/mobs/:id', (req, res) => {
  try {
    const current = getSessionMobById(req.params.id);
    if (!current) return res.status(404).json({ message: 'Mob introuvable dans la partie active.' });

    const requested = req.body || {};
    const merged = {
      ...current,
      ...requested,
      id: current.id,
      hp: requested.hp ? { ...current.hp, ...requested.hp } : current.hp,
      mana: requested.mana ? { ...current.mana, ...requested.mana } : current.mana
    };

    const mob = normaliserMob(merged, { id: current.id });
    if (!sauvegarderMobSession(mob)) {
      return res.status(500).json({ message: 'Impossible de modifier le mob.' });
    }
    io.emit('mobUpdated', { type: 'updated', mob });
    io.emit('sceneUpdated');
    emitMapState();
    res.json({ message: 'Mob modifié avec succès.', mob });
  } catch (error) {
    console.error('Erreur modification mob:', error);
    res.status(500).json({ message: 'Impossible de modifier le mob.' });
  }
});

app.delete('/api/mobs/:id', (req, res) => {
  try {
    if (!supprimerMobSession(req.params.id)) {
      return res.status(404).json({ message: 'Mob introuvable dans la partie active.' });
    }
    io.emit('mobUpdated', { type: 'deleted', mobId: req.params.id });
    io.emit('sceneUpdated');
    emitMapState();
    res.json({ message: 'Mob retiré de la partie active.' });
  } catch (error) {
    console.error('Erreur suppression mob:', error);
    res.status(500).json({ message: 'Impossible de supprimer le mob.' });
  }
});

/** Copie indépendante d'un mob de la partie (nouvel id, nom numéroté). */
app.post('/api/mobs/:id/duplicate', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  try {
    const source = getSessionMobById(req.params.id);
    if (!source) return res.status(404).json({ message: 'Mob introuvable dans la partie active.' });

    const mob = duplicateMob(source, getSessionMobs());
    if (!mob || !sauvegarderMobSession(mob)) {
      return res.status(500).json({ message: 'Impossible de dupliquer le mob.' });
    }
    io.emit('mobUpdated', { type: 'duplicated', mob });
    io.emit('sceneUpdated');
    emitMapState();
    res.status(201).json({ message: `« ${mob.nom} » ajouté à la partie.`, mob });
  } catch (error) {
    console.error('Erreur duplication mob:', error);
    res.status(500).json({ message: 'Impossible de dupliquer le mob.' });
  }
});

app.get('/api/mob-templates', (req, res) => {
  res.json(getMobTemplates());
});

app.post('/api/mob-templates', (req, res) => {
  try {
    if (!req.body?.nom || !String(req.body.nom).trim()) {
      return res.status(400).json({ message: 'Le nom du template est requis.' });
    }
    const template = createMobTemplate(req.body);
    if (!template) return res.status(500).json({ message: 'Impossible de sauvegarder le template.' });

    io.emit('mobTemplateUpdated', { type: 'created', template });
    res.status(201).json({ message: 'Template de mob créé avec succès.', template });
  } catch (error) {
    console.error('Erreur création template:', error);
    res.status(500).json({ message: 'Impossible de créer le template.' });
  }
});

app.put('/api/mob-templates/:id', (req, res) => {
  try {
    const template = updateMobTemplate(req.params.id, req.body || {});
    if (!template) return res.status(404).json({ message: 'Template de mob introuvable.' });

    io.emit('mobTemplateUpdated', { type: 'updated', template });
    res.json({ message: 'Template de mob modifié avec succès.', template });
  } catch (error) {
    console.error('Erreur modification template:', error);
    res.status(500).json({ message: 'Impossible de modifier le template.' });
  }
});

app.delete('/api/mob-templates/:id', (req, res) => {
  try {
    if (!deleteMobTemplate(req.params.id)) {
      return res.status(404).json({ message: 'Template de mob introuvable.' });
    }
    io.emit('mobTemplateUpdated', { type: 'deleted', templateId: req.params.id });
    res.json({ message: 'Template supprimé.' });
  } catch (error) {
    console.error('Erreur suppression template:', error);
    res.status(500).json({ message: 'Impossible de supprimer le template.' });
  }
});

// ------------------------------------------------------------------
// V1.13.6 — BESTIAIRE : bibliotheque de creatures du MJ
//
// Trois niveaux, deja portes par le modele depuis V1.13.5 :
//   MODELE    mob_templates.json  definition reutilisable
//   INSTANCE  session.mobs        etat propre a la partie
//   TOKEN     maps.json           position sur une carte
//
// Ces routes n'ajoutent aucune donnee : elles exposent les transitions
// entre ces trois niveaux.
// ------------------------------------------------------------------

app.get('/api/mob-categories', (req, res) => {
  res.json(getCategoriesMob());
});

/** Gobelin -> Gobelin Archer, sans toucher a l'original. */
app.post('/api/mob-templates/:id/duplicate', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const template = duplicateMobTemplate(req.params.id, req.body?.nom);
  if (!template) return res.status(404).json({ message: 'Modele de creature introuvable.' });

  io.emit('mobTemplateUpdated', { type: 'duplicated', template });
  res.status(201).json({ message: `« ${template.nom} » ajoute au bestiaire.`, template });
});

/** Promeut une creature de la partie en modele reutilisable. */
app.post('/api/mob-templates/from-mob/:mobId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const mob = getSessionMobById(req.params.mobId);
  if (!mob) return res.status(404).json({ message: 'Creature introuvable dans la partie.' });

  const template = templateDepuisMob(mob, req.body?.nom);
  if (!template) return res.status(500).json({ message: 'Impossible de creer le modele.' });

  io.emit('mobTemplateUpdated', { type: 'created', template });
  res.status(201).json({ message: `« ${template.nom} » ajoute au bestiaire.`, template });
});

app.post('/api/mob-templates/:id/spawn', (req, res) => {
  try {
    // Numérotation automatique : « Gobelin », puis « Gobelin #2 »…
    const mob = createMobFromTemplate(req.params.id, req.body || {}, {
      mobsExistants: getSessionMobs()
    });
    if (!mob) return res.status(404).json({ message: 'Template de mob introuvable.' });

    if (!sauvegarderMobSession(mob)) {
      return res.status(500).json({ message: 'Impossible de créer le mob dans la partie.' });
    }

    io.emit('mobUpdated', { type: 'createdFromTemplate', mob });
    io.emit('sceneUpdated');
    emitMapState();
    res.status(201).json({ message: 'Mob créé depuis le template.', mob });
  } catch (error) {
    console.error('Erreur création mob depuis template:', error);
    res.status(500).json({ message: 'Impossible de créer le mob depuis le template.' });
  }
});

app.get('/api/session/export', (req, res) => {
  try {
    const session = require('./session').getSession();

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
        session: result.session.players[playerId]
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
    player: joueurMisAJour
  });
});

app.post('/api/session/player', (req, res) => {
  const { id, nouvellesDonnees } = req.body;

  if (!id || !nouvellesDonnees) {
    return res.status(400).json({
      message: "L'identifiant du joueur et les données de session sont requis."
    });
  }

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

  const joueurSession = getSessionPlayerById(id);

  // Événement spécifique à la session : la fiche de personnage
  // n'écoute volontairement PAS cet événement.
  io.emit('sessionPlayerUpdate', {
    type: 'update',
    player: joueur.nom,
    playerId: id,
    session: joueurSession
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

// API pour supprimer un joueur par son identifiant stable.
// L'ancien endpoint par nom reste disponible pour compatibilité.
app.delete('/api/joueurs/delete/:id', (req, res) => {
  // Suppression définitive d'un personnage : réservée au MJ.
  if (refuserSiPasMj(req, res)) return;

  const id = req.params.id;
  const joueur = getJoueurById(id);

  if (!joueur) {
    return res.status(404).send('Joueur non trouvé');
  }

  const success = supprimerJoueur({ id });

  if (success) {
    io.emit('playerUpdate', {
      type: 'delete',
      player: joueur.nom,
      playerId: joueur.id
    });
    res.status(200).send(`Joueur ${joueur.nom} supprimé`);
  } else {
    res.status(500).send('Erreur lors de la suppression du joueur');
  }
});

// Compatibilité avec les anciens liens qui utilisent encore le nom.
app.delete('/api/joueurs/delete-by-name/:nom', (req, res) => {
  // Shim de compatibilité, sans appelant connu — mais tout aussi
  // destructeur que la route par ID : même contrôle.
  if (refuserSiPasMj(req, res)) return;

  const nom = req.params.nom;
  const joueur = getJoueurs().find(
    player => typeof player.nom === 'string' &&
      player.nom.toLowerCase() === nom.toLowerCase()
  );

  if (!joueur) {
    return res.status(404).send(`Joueur ${nom} non trouvé`);
  }

  const success = supprimerJoueur({ id: joueur.id });

  if (success) {
    io.emit('playerUpdate', {
      type: 'delete',
      player: joueur.nom,
      playerId: joueur.id
    });
    res.status(200).send(`Joueur ${nom} supprimé`);
  } else {
    res.status(500).send('Erreur lors de la suppression du joueur');
  }
});

// API pour mettre à jour un joueur
app.post('/api/joueur', (req, res) => {
  console.log("Mise à jour du joueur :", req.body);
  const { id, nom, nouvellesDonnees } = req.body;

  if ((!id && !nom) || !nouvellesDonnees) {
    return res.status(400).json({
      message: "L'identifiant du joueur et les nouvelles données sont requis."
    });
  }

  const success = sauvegardeData({ id, nom }, nouvellesDonnees);

  if (success) {
    const joueurMisAJour = id
      ? getJoueurById(id)
      : getJoueurs().find(
          joueur => typeof joueur.nom === 'string' &&
            joueur.nom.toLowerCase() === nom.toLowerCase()
        );

    if (!joueurMisAJour) {
      return res.status(500).json({
        message: "Le joueur a été sauvegardé mais son état actuel est introuvable."
      });
    }

    // Flux volontairement à sens unique :
    // Fiche de Perso -> état de session -> Interface de Jeu.
    const sessionSynced = synchroniserSessionDepuisPersonnage(joueurMisAJour);

    if (!sessionSynced) {
      return res.status(500).json({
        message: "Le personnage a été sauvegardé, mais l'état de session n'a pas pu être synchronisé."
      });
    }

    io.emit('playerUpdate', {
      type: 'update',
      player: joueurMisAJour.nom,
      playerId: joueurMisAJour.id
    });

    res.status(200).json({
      message: `Les données du joueur ${joueurMisAJour.nom} ont été mises à jour avec succès.`,
      playerId: joueurMisAJour.id
    });
  } else {
    res.status(404).json({ message: 'Joueur non trouvé.' });
  }
});

// Ajouter cette route pour accéder à la base de données
app.get('/api/game-database', (req, res) => {
  try {
    const databasePath = cheminDonnees('database', 'game_database.json');
    fs.readFile(databasePath, 'utf8', (err, data) => {
      if (err) {
        console.error('Erreur lors de la lecture de la base de données:', err);
        return res.status(500).json({ error: 'Erreur lors de la lecture de la base de données' });
      }
      try {
        const jsonData = JSON.parse(data);
        res.json({ ...jsonData, ...(listesSortsReference() || {}) });
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

// ------------------------------------------------------------------
// Interface Modification — édition de la référence (sorts.json).
// Lecture libre ; toute écriture est réservée au MJ.
// ------------------------------------------------------------------

app.get('/api/reference', (req, res) => {
  try {
    res.json(sortsRef.lireReference());
  } catch (error) {
    console.error('Lecture de sorts.json impossible:', error);
    res.status(500).json({ message: 'Lecture de sorts.json impossible.' });
  }
});

function routeReference(res, action, statutSucces = 200) {
  try {
    const result = action();
    if (!result.success) {
      return res.status(result.introuvable ? 404 : 400).json({ message: result.message });
    }
    io.emit('referenceUpdated');
    res.status(statutSucces).json(result);
  } catch (error) {
    console.error('Modification de sorts.json impossible:', error);
    res.status(500).json({ message: 'Modification de sorts.json impossible.' });
  }
}

app.post('/api/reference/sorts', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.creerSort(req.body), 201);
});
app.put('/api/reference/sorts/:id', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.modifierSort(req.params.id, req.body));
});
app.delete('/api/reference/sorts/:id', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.supprimerSort(req.params.id));
});
app.post('/api/reference/sorts/:id/duplicate', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.dupliquerSort(req.params.id), 201);
});

app.post('/api/reference/attaques', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.creerAttaque(req.body), 201);
});
app.put('/api/reference/attaques/:id', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.modifierAttaque(req.params.id, req.body));
});
app.delete('/api/reference/attaques/:id', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.supprimerAttaque(req.params.id));
});
app.post('/api/reference/attaques/:id/duplicate', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  routeReference(res, () => sortsRef.dupliquerAttaque(req.params.id), 201);
});

// ------------------------------------------------------------------
// V1.13 — SYSTÈME DE CARTES (MAPS)
//
// Principes :
//  1. La carte est une donnée de partie : le serveur est autoritaire.
//  2. Le client ne reçoit JAMAIS la carte brute, seulement une projection
//     construite pour son rôle (map.getMapForViewer).
//  3. Toute mutation MJ passe par REST ; seul le déplacement de token
//     (haute fréquence) passe par Socket.IO.
//  4. Après chaque mutation, le serveur pousse à chaque socket connecté
//     SA propre projection : aucune donnée MJ ne transite vers un joueur.
// ------------------------------------------------------------------

// Point d'entrée unique du contrôle d'accès MJ.
// Le projet reste en périmètre LAN sans authentification (cf. V1.12) :
// centraliser ici permettra d'ajouter un vrai contrôle en un seul endroit.
function roleDepuisRequete(req) {
  const role = req.body?.role ?? req.query?.role;
  return role === 'mj' ? 'mj' : 'player';
}

function playerIdDepuisRequete(req) {
  const id = req.body?.playerId ?? req.query?.playerId;
  return typeof id === 'string' && id ? id : null;
}

function refuserSiPasMj(req, res) {
  if (roleDepuisRequete(req) !== 'mj') {
    res.status(403).json({ message: 'Action réservée au Maître du Jeu.' });
    return true;
  }
  return false;
}

/**
 * Données d'affichage des entités référencées par les tokens.
 * map.js ne connaît pas session.js : c'est server.js qui compose.
 */
function buildMapEntities() {
  const players = getJoueurs().map(joueur => {
    const etat = getSessionPlayerById(joueur.id) || ensureSessionPlayer(joueur);
    return {
      id: joueur.id,
      nom: etat.nom || joueur.nom,
      hp: etat.hp || { current: 0, max: 0 },
      statuts: etat.statuts || []
    };
  });

  const mobs = Object.values(getSessionMobs()).map(mob => ({
    id: mob.id,
    nom: mob.nom,
    hp: mob.hp || { current: 0, max: 0 },
    mana: mob.mana || { current: 0, max: 0 },
    statut: mob.statut || 'vivant',
    statuts: mob.statuts || [],
    description: mob.description || '',
    notes: mob.notes || ''
  }));

  return { players, mobs };
}

/**
 * Résout la carte active et la remet en cohérence avec la partie
 * (nouveaux personnages placés, entités supprimées retirées).
 */
function chargerCarteActive() {
  const mapId = getActiveMapId();
  if (!mapId) return null;

  if (!mapStore.getMapById(mapId)) {
    // La carte a été supprimée : la session ne doit pas garder un
    // pointeur mort.
    setActiveMapId(null);
    return null;
  }

  const entities = buildMapEntities();
  mapStore.synchroniserTokens(mapId, entities);
  return { mapId, entities };
}

function getActiveMapForViewer(role, playerId) {
  const contexte = chargerCarteActive();
  if (!contexte) return null;
  return mapStore.getMapForViewer(contexte.mapId, {
    role: role === 'mj' ? 'mj' : 'player',
    playerId,
    entities: contexte.entities
  });
}

/**
 * Diffusion temps réel de la carte.
 *
 * Chaque socket reçoit la projection correspondant à SON rôle. Les
 * projections sont mémoïsées par couple (rôle, joueur) : une table de
 * cinq joueurs ne provoque que six calculs de vision au maximum.
 *
 * `socketCible` permet de ne réémettre que vers un client précis
 * (connexion / demande explicite).
 */
function emitMapState(socketCible) {
  const contexte = chargerCarteActive();
  const cache = new Map();

  const sockets = socketCible
    ? [socketCible]
    : [...io.sockets.sockets.values()];

  sockets.forEach(socket => {
    // Trois projections : MJ, écran partagé (vision du groupe), joueur.
    const roleDemande = socket.handshake.query?.role;
    const role = roleDemande === 'mj' || roleDemande === 'ecran' ? roleDemande : 'player';
    const playerId = role === 'player' ? socket.handshake.query?.playerId || null : null;
    const cle = role === 'player' ? `player|${playerId}` : role;

    if (!cache.has(cle)) {
      cache.set(cle, contexte
        ? mapStore.getMapForViewer(contexte.mapId, { role, playerId, entities: contexte.entities })
        : null);
    }

    const projection = cache.get(cle);

    // V1.13.11 — On n'envoie que ce qui a changé DEPUIS LE DERNIER ENVOI À
    // CE SOCKET. La mémoire est portée par le socket, jamais par le cache
    // par rôle : deux postes du même joueur n'en sont pas au même point.
    //
    // Le repère est invalidé dès que la carte, le rôle ou le personnage
    // change — sinon le client fusionnerait des champs appartenant à une
    // autre carte.
    const memoire = socket.data.allegement;
    const memeContexte = memoire
      && memoire.cle === cle
      && memoire.mapId === (projection ? projection.id : null);

    const { payload, empreintes } =
      allegement.alleger(projection, memeContexte ? memoire.empreintes : null);

    socket.data.allegement = {
      cle,
      mapId: projection ? projection.id : null,
      empreintes
    };

    socket.emit('mapState', payload);
  });
}

// --- Bibliothèque de cartes ---------------------------------------

// V1.13.5 — La route GET /api/map/element-kinds a été retirée : plus aucun
// appelant depuis le passage aux palettes par biome (V1.13.4), qui exposent
// des pinceaux concrets via GET /api/map/palette. KINDS_ELEMENT reste dans
// map.js, où normaliserElement() s'en sert toujours.

app.get('/api/maps', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  res.json({ maps: mapStore.getMaps(), activeMapId: getActiveMapId() });
});

app.post('/api/maps', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.createMap(req.body || {});
  if (!result.success) {
    // 409 : la carte n'a pas été créée parce qu'une identique existe déjà.
    return res.status(result.duplicate ? 409 : 500)
      .json({ message: result.message, existingMapId: result.existingMapId });
  }

  // Une première carte devient automatiquement la carte active.
  if (!getActiveMapId()) setActiveMapId(result.map.id);

  io.emit('mapLibraryUpdated');
  emitMapState();
  res.status(201).json({ message: 'Carte créée.', map: result.map });
});

app.put('/api/maps/:mapId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.updateMap(req.params.mapId, req.body || {});
  if (!result.success) {
    return res.status(result.message === 'Carte introuvable.' ? 404 : 500)
      .json({ message: result.message });
  }

  io.emit('mapLibraryUpdated');
  emitMapState();
  res.json({ message: 'Carte modifiée.', map: result.map });
});

/** Résolution du quadrillage (1 à 4) : convertit la carte, voir map.js. */
app.post('/api/maps/:mapId/resolution', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.changerResolution(req.params.mapId, req.body?.resolution);
  if (!result.success) {
    if (result.unchanged) return res.json({ message: result.message });
    return res.status(result.message === 'Carte introuvable.' ? 404 : 400).json({ message: result.message });
  }

  io.emit('mapLibraryUpdated');
  emitMapState();
  res.json({
    message: `Quadrillage ×${result.resolution} : ${result.cols}×${result.rows} cases.`,
    resolution: result.resolution
  });
});

app.delete('/api/maps/:mapId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.deleteMap(req.params.mapId);
  if (!result.success) return res.status(404).json({ message: result.message });

  if (getActiveMapId() === req.params.mapId) setActiveMapId(null);

  io.emit('mapLibraryUpdated');
  emitMapState();
  res.json({ message: 'Carte supprimée.' });
});

app.post('/api/maps/:mapId/duplicate', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.duplicateMap(req.params.mapId, req.body?.nom);
  if (!result.success) return res.status(404).json({ message: result.message });

  io.emit('mapLibraryUpdated');
  res.status(201).json({ message: 'Carte dupliquée.', map: result.map });
});

// ------------------------------------------------------------------
// V1.13.10 — L'œil du joueur.
//
// Le MJ demande la projection d'un personnage : EXACTEMENT celle que ce
// joueur reçoit, construite par le même chemin. On ne recalcule rien et
// surtout on ne « simule » rien : simuler laisserait passer un écart
// entre ce que le MJ croit montrer et ce que le joueur voit vraiment.
//
// Route de LECTURE : aucune écriture, aucune diffusion.
// ------------------------------------------------------------------
app.get('/api/map/vue-joueur/:playerId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const playerId = req.params.playerId;
  if (!getJoueurById(playerId)) {
    return res.status(404).json({ message: 'Personnage introuvable.' });
  }

  const projection = getActiveMapForViewer('player', playerId);
  if (!projection) {
    return res.status(404).json({ message: 'Aucune carte active.' });
  }

  res.json(projection);
});

// V1.13.11 — Ouvrir ou fermer toutes les portes d'un coup.
app.post('/api/maps/:mapId/portes', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.basculerPortes(req.params.mapId, req.body?.fermer === true);
  if (!result.success) {
    return res.status(result.message === 'Carte introuvable.' ? 404 : 400)
      .json({ message: result.message });
  }

  emitMapState();
  res.json({
    message: (req.body?.fermer === true ? 'Portes fermées : ' : 'Portes ouvertes : ')
      + result.touchees + '.',
    touchees: result.touchees
  });
});

app.post('/api/maps/:mapId/activate', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  if (!mapStore.getMapById(req.params.mapId)) {
    return res.status(404).json({ message: 'Carte introuvable.' });
  }

  const result = setActiveMapId(req.params.mapId);
  if (!result.success) return res.status(500).json({ message: result.message });

  io.emit('mapLibraryUpdated');
  emitMapState();
  res.json({ message: 'Carte chargée pour toute la table.', activeMapId: result.activeMapId });
});

/**
 * Lecture de la carte active, filtrée pour le demandeur.
 * C'est la seule route de lecture accessible aux joueurs.
 */
app.get('/api/map/active', (req, res) => {
  try {
    const vue = getActiveMapForViewer(roleDepuisRequete(req), playerIdDepuisRequete(req));
    res.json({ map: vue, activeMapId: getActiveMapId() });
  } catch (error) {
    console.error('Erreur lors du chargement de la carte active:', error);
    res.status(500).json({ message: 'Impossible de charger la carte active.' });
  }
});

// --- Types de lieu et palette de décors ----------------------------
//
// La génération automatique de cartes a été retirée : mapgen.js ne sert
// plus qu'au catalogue des types de lieu et des décors posés par le MJ.

app.get('/api/map/generators', (req, res) => {
  res.json(mapGen.getGenerateurs());
});

/**
 * Palette de décors adaptée à un type de lieu.
 *
 * C'est ce qui permet au MJ de poser « un arbre » dans une forêt et
 * « un tonneau » dans une taverne, au lieu de sept types génériques.
 * Un type inconnu renvoie la palette complète : le MJ n'est jamais
 * bloqué sur une carte dessinée à la main.
 */
app.get('/api/map/palette', (req, res) => {
  res.json(mapGen.getPalette(typeof req.query?.type === 'string' ? req.query.type : ''));
});

// --- Tokens (entités mobiles) --------------------------------------

app.post('/api/maps/:mapId/tokens', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.placerToken(req.params.mapId, req.body || {});
  if (!result.success) return res.status(400).json({ message: result.message });

  emitMapState();
  res.status(201).json({ message: 'Token placé.', tokenId: result.tokenId });
});

app.put('/api/maps/:mapId/tokens/:tokenId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.updateToken(req.params.mapId, req.params.tokenId, req.body || {});
  if (!result.success) return res.status(404).json({ message: result.message });

  emitMapState();
  res.json({ message: 'Token mis à jour.', tokenId: result.tokenId });
});

app.delete('/api/maps/:mapId/tokens/:tokenId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.retirerToken(req.params.mapId, req.params.tokenId);
  if (!result.success) return res.status(404).json({ message: result.message });

  emitMapState();
  res.json({ message: 'Token retiré de la carte.' });
});

/**
 * Crée un mob depuis un template ET le place sur la carte en une action.
 * Réutilise intégralement mob.js et session.js : un NPC de carte EST un
 * mob de la partie, éditable depuis l'interface MJ existante.
 */
app.post('/api/maps/:mapId/spawn-mob', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  try {
    const { templateId, x, y } = req.body || {};
    const mobsExistants = getSessionMobs();

    // Dans les deux cas, l'instance reçoit un nom distinct : trois
    // créatures issues du même modèle ne doivent pas être homonymes.
    const mob = templateId
      ? createMobFromTemplate(templateId, req.body?.overrides || {}, { mobsExistants })
      : normaliserMob({
          ...(req.body?.mob || {}),
          nom: nommerInstance(req.body?.mob?.nom || 'Créature', mobsExistants)
        });

    if (!mob) return res.status(404).json({ message: 'Template de mob introuvable.' });
    if (!sauvegarderMobSession(mob)) {
      return res.status(500).json({ message: 'Impossible de créer le mob dans la partie.' });
    }

    const result = mapStore.placerToken(req.params.mapId, {
      kind: 'mob',
      entityId: mob.id,
      x,
      y,
      visibleToPlayers: req.body?.visibleToPlayers !== false
    });

    if (!result.success) return res.status(400).json({ message: result.message });

    io.emit('mobUpdated', { type: 'createdOnMap', mob });
    io.emit('sceneUpdated');
    emitMapState();
    res.status(201).json({ message: 'Créature ajoutée à la carte.', mob, tokenId: result.tokenId });
  } catch (error) {
    console.error('Erreur lors de la création du mob sur la carte:', error);
    res.status(500).json({ message: 'Impossible de créer la créature.' });
  }
});

// --- Éléments statiques (décor, obstacles, objets) -----------------

app.post('/api/maps/:mapId/elements', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  // Le client peut désigner un pinceau de la palette (`brush`) plutôt que
  // de réécrire tout le descripteur : c'est le serveur qui le résout, il
  // ne fait jamais confiance aux propriétés envoyées pour un pinceau connu.
  let donnees = req.body || {};
  if (typeof donnees.brush === 'string' && donnees.brush) {
    const materiau = mapGen.getMateriau(donnees.brush);
    if (!materiau) return res.status(400).json({ message: 'Pinceau de décor inconnu.' });
    donnees = { ...donnees, ...materiau };
    // Le MJ garde la main sur le nom et les notes qu'il ajoute.
    if (req.body.nom) donnees.nom = req.body.nom;
    if (req.body.gmNotes) donnees.gmNotes = req.body.gmNotes;
  }

  const result = mapStore.ajouterElement(req.params.mapId, donnees);
  if (!result.success) return res.status(400).json({ message: result.message });

  emitMapState();
  res.status(201).json({ message: 'Élément ajouté.', elementId: result.elementId });
});

/**
 * Pose PAR LOT : un seul aller-retour pour tout un trace au pinceau.
 * Le pinceau est resolu par le SERVEUR, comme pour la pose unitaire.
 */
app.post('/api/maps/:mapId/elements/batch', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const cellules = Array.isArray(req.body?.cells) ? req.body.cells : [];
  if (!cellules.length) return res.status(400).json({ message: 'Aucune case fournie.' });
  if (cellules.length > 2000) {
    return res.status(400).json({ message: 'Trop de cases en une seule pose (2000 maximum).' });
  }

  let modele = {};
  if (typeof req.body?.brush === 'string' && req.body.brush) {
    const materiau = mapGen.getMateriau(req.body.brush);
    if (!materiau) return res.status(400).json({ message: 'Pinceau de decor inconnu.' });
    modele = materiau;
  } else if (typeof req.body?.kind === 'string') {
    modele = { kind: req.body.kind };
  }

  if (req.body?.nom) modele = { ...modele, nom: req.body.nom };
  // Pinceau de couleur du MJ : la couleur est validée par map.js (#rrggbb).
  if (typeof req.body?.color === 'string') modele = { ...modele, color: req.body.color };

  const liste = cellules.map(cellule => ({ ...modele, x: cellule?.x, y: cellule?.y }));
  const result = mapStore.ajouterElements(req.params.mapId, liste);
  if (!result.success) return res.status(400).json({ message: result.message });

  emitMapState();
  res.status(201).json({
    message: `${result.elementIds.length} element(s) pose(s).`,
    elementIds: result.elementIds
  });
});

app.put('/api/maps/:mapId/elements/:elementId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.updateElement(req.params.mapId, req.params.elementId, req.body || {});
  if (!result.success) return res.status(404).json({ message: result.message });

  emitMapState();
  res.json({ message: 'Élément modifié.', elementId: result.elementId });
});

app.delete('/api/maps/:mapId/elements/:elementId', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.supprimerElement(req.params.mapId, req.params.elementId);
  if (!result.success) return res.status(404).json({ message: result.message });

  emitMapState();
  res.json({ message: 'Élément supprimé.' });
});

/** Retrait par lot : une seule mutation pour annuler toute une pose. */
app.delete('/api/maps/:mapId/elements', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const ids = Array.isArray(req.body?.elementIds) ? req.body.elementIds : [];
  if (ids.length > 2000) {
    return res.status(400).json({ message: 'Trop d\'éléments en une seule fois (2000 maximum).' });
  }

  const result = mapStore.supprimerElements(req.params.mapId, ids);
  if (!result.success) return res.status(400).json({ message: result.message });

  emitMapState();
  res.json({ message: `${result.retires} élément(s) retiré(s).`, retires: result.retires });
});

// --- Annotations : le tableau blanc posé sur la carte --------------
//
// Contrairement au tableau blanc V1.10, dont les tracés étaient
// simplement rediffusés et perdus au rechargement, une annotation de
// carte est persistée, attribuée à un auteur et filtrée par rôle.
//
// Le tracé en cours est diffusé par Socket.IO (aperçu, aucune écriture),
// puis enregistré en une seule requête au relâchement du pointeur.

app.post('/api/maps/:mapId/annotations', (req, res) => {
  const role = roleDepuisRequete(req);
  const playerId = playerIdDepuisRequete(req);

  if (role !== 'mj' && (!playerId || !getJoueurById(playerId))) {
    return res.status(403).json({ message: 'Personnage inconnu.' });
  }

  const result = mapStore.ajouterAnnotation(req.params.mapId, req.body || {}, { role, playerId });
  if (!result.success) {
    return res.status(result.message === 'Carte introuvable.' ? 404 : 400)
      .json({ message: result.message });
  }

  emitMapState();
  res.status(201).json({ message: 'Annotation enregistrée.', annotationId: result.annotationId });
});

app.delete('/api/maps/:mapId/annotations/:annotationId', (req, res) => {
  const role = roleDepuisRequete(req);
  const playerId = playerIdDepuisRequete(req);

  const result = mapStore.supprimerAnnotation(
    req.params.mapId,
    req.params.annotationId,
    { role, playerId }
  );

  if (!result.success) {
    const refus = result.message.startsWith('Vous ne pouvez');
    return res.status(refus ? 403 : 404).json({ message: result.message });
  }

  emitMapState();
  res.json({ message: 'Annotation effacée.' });
});

app.delete('/api/maps/:mapId/annotations', (req, res) => {
  const role = roleDepuisRequete(req);
  const playerId = playerIdDepuisRequete(req);

  const result = mapStore.viderAnnotations(
    req.params.mapId,
    req.body?.scope || 'all',
    { role, playerId }
  );

  if (!result.success) return res.status(404).json({ message: result.message });

  emitMapState();
  res.json({ message: `${result.retirees} annotation(s) effacée(s).`, retirees: result.retirees });
});

app.put('/api/maps/:mapId/drawing', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.setDrawingConfig(req.params.mapId, {
    playersAllowed: req.body?.playersAllowed === true
  });

  if (!result.success) return res.status(404).json({ message: result.message });

  emitMapState();
  res.json({
    message: result.map.drawing.playersAllowed
      ? 'Les joueurs peuvent annoter la carte.'
      : 'Les annotations des joueurs sont désactivées.',
    drawing: result.map.drawing
  });
});

// --- Brouillard de guerre & vision ---------------------------------

app.put('/api/maps/:mapId/fog', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  // Ne transmettre que les champs réellement fournis : setFogConfig
  // fusionne avec l'état courant, et une clé présente mais `undefined`
  // écraserait silencieusement le réglage existant.
  const reglages = {};
  if (typeof req.body?.enabled === 'boolean') reglages.enabled = req.body.enabled;
  if (typeof req.body?.mode === 'string') reglages.mode = req.body.mode;
  if (typeof req.body?.autoReveal === 'boolean') reglages.autoReveal = req.body.autoReveal;

  const result = mapStore.setFogConfig(req.params.mapId, reglages);

  if (!result.success) return res.status(404).json({ message: result.message });

  // Activer la vision doit immédiatement refléter ce que le groupe voit.
  mapStore.rafraichirExploration(req.params.mapId);
  emitMapState();
  res.json({ message: 'Brouillard de guerre mis à jour.', fog: result.map.fog });
});

app.post('/api/maps/:mapId/fog/cells', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.revelerCellules(
    req.params.mapId,
    req.body?.cells,
    req.body?.revealed !== false
  );

  if (!result.success) return res.status(400).json({ message: result.message });

  emitMapState();
  res.json({ message: 'Zones mises à jour.', revealedCount: result.revealedCount });
});

app.post('/api/maps/:mapId/fog/reset', (req, res) => {
  if (refuserSiPasMj(req, res)) return;

  const result = mapStore.resetFog(req.params.mapId);
  if (!result.success) return res.status(404).json({ message: result.message });

  emitMapState();
  res.json({ message: 'Brouillard de guerre réinitialisé.' });
});

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
  socket.on('draw', data => socket.broadcast.emit('draw', data));

  // Événement d'écriture
  socket.on('text', data => socket.broadcast.emit('text', data));

  // Les dessins restent temporaires à la séance : aucun enregistrement
  // permanent n'est nécessaire pour le tableau blanc V1.10.
  socket.on('clearDrawings', () => {
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
  const fichiers = ['data.json', 'session.json', 'maps.json', 'mob_templates.json']
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
  });
});