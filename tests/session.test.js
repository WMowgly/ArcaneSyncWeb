// Bac a sable de donnees : DOIT rester le tout premier require.
const bacDonnees = require('./_donnees');
const fs = require('fs');
const path = require('path');

const dataFile = bacDonnees.chemin('data.json');
const sessionFile = bacDonnees.chemin('session.json');

const originalData = fs.readFileSync(dataFile, 'utf8');
const originalSession = fs.existsSync(sessionFile)
  ? fs.readFileSync(sessionFile, 'utf8')
  : null;

try {
  delete require.cache[require.resolve('../joueur')];
  delete require.cache[require.resolve('../session')];

  const { getJoueurs, getJoueurById, sauvegardeData } = require('../joueur');
  const {
    getSessionPlayerById,
    synchroniserSessionDepuisPersonnage,
    sauvegarderEtatSession,
    getDonneesPersonnageDepuisSession,
    importerSession,
    validerSessionImport
  } = require('../session');

  const joueur = getJoueurs()[0];

  if (!joueur || !joueur.id) {
    throw new Error('Aucun joueur avec ID stable disponible.');
  }

  // Initialiser la session depuis le personnage.
  if (!synchroniserSessionDepuisPersonnage(joueur)) {
    throw new Error('Impossible de synchroniser le personnage vers la session.');
  }

  const sessionAvant = getSessionPlayerById(joueur.id);
  if (!sessionAvant) {
    throw new Error('État de session introuvable.');
  }

  const dataAvant = fs.readFileSync(dataFile, 'utf8');

  const sessionOriginale = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  const validationSession = validerSessionImport(sessionOriginale);
  if (!validationSession.valid) {
    throw new Error('La session de test devrait être valide.');
  }

  const donneesPourImport = getDonneesPersonnageDepuisSession(joueur.id);
  if (!donneesPourImport || !donneesPourImport.hp) {
    throw new Error("Impossible de préparer les données pour l'import manuel.");
  }

  const invalidValidation = validerSessionImport({ id: 'x', players: { bad: { id: 'different' } } });
  if (invalidValidation.valid) {
    throw new Error('Une session invalide a été acceptée.');
  }

  // Simuler une modification de l'Interface de Jeu.
  const nouveauHp = Math.max(0, (sessionAvant.hp?.current ?? 0) - 7);

  if (!sauvegarderEtatSession(joueur.id, {
    hp: { current: nouveauHp }
  })) {
    throw new Error('Sauvegarde de session échouée.');
  }

  const sessionApres = getSessionPlayerById(joueur.id);
  if (sessionApres.hp.current !== nouveauHp) {
    throw new Error('La modification de session n\'est pas persistée.');
  }

  // Une valeur actuelle ne dépasse jamais son maximum (ni ne passe sous 0).
  sauvegarderEtatSession(joueur.id, {
    hp: { current: (sessionApres.hp.max ?? 0) + 50 },
    mana: { current: -4 },
    armure: { durabilite: { current: 9999 } }
  });
  const borne = getSessionPlayerById(joueur.id);
  if (borne.hp.current !== borne.hp.max || borne.mana.current !== 0
    || borne.armure.durabilite.current !== borne.armure.durabilite.max) {
    throw new Error(`Valeurs non bornées : ${JSON.stringify({ hp: borne.hp, mana: borne.mana, dura: borne.armure.durabilite })}`);
  }
  sauvegarderEtatSession(joueur.id, { hp: { current: nouveauHp } });

  // Le fichier personnage doit rester strictement identique.
  const dataApresSession = fs.readFileSync(dataFile, 'utf8');
  if (dataApresSession !== dataAvant) {
    throw new Error('L\'Interface de Jeu a modifié data.json.');
  }

  // Simuler une modification depuis la Fiche de Perso.
  const nouveauHpPersonnage = (joueur.hp?.current ?? 0) + 3;

  const ok = sauvegardeData(
    { id: joueur.id },
    { hp: { current: nouveauHpPersonnage } }
  );

  if (!ok) {
    throw new Error('Sauvegarde de la Fiche de Perso échouée.');
  }

  const joueurApres = getJoueurById(joueur.id);

  if (joueurApres.hp.current !== nouveauHpPersonnage) {
    throw new Error('La modification de la Fiche de Perso n\'est pas persistée.');
  }

  // Après une sauvegarde de fiche, la session doit recevoir la nouvelle valeur.
  synchroniserSessionDepuisPersonnage(joueurApres);

  const sessionApresFiche = getSessionPlayerById(joueur.id);
  if (sessionApresFiche.hp.current !== nouveauHpPersonnage) {
    throw new Error('La Fiche de Perso ne synchronise pas la session.');
  }

  console.log('PASS: session séparée + interface -> session uniquement + fiche -> session');
} finally {
  fs.writeFileSync(dataFile, originalData, 'utf8');

  if (originalSession !== null) {
    fs.writeFileSync(sessionFile, originalSession, 'utf8');
  }

  delete require.cache[require.resolve('../joueur')];
  delete require.cache[require.resolve('../session')];
}


// v1.5.1 frontend/API contract checks
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const mjSource = fs.readFileSync(path.join(__dirname, '..', 'website', 'mj.html'), 'utf8');
const selectionSource = fs.readFileSync(path.join(__dirname, '..', 'website', 'selecte_player.html'), 'utf8');

if (!serverSource.includes("app.get('/api/session/players'")) {
  throw new Error("Endpoint /api/session/players manquant.");
}
if (!mjSource.includes("fetch('/api/session/players')")) {
  throw new Error("Interface MJ ne charge pas l'état de session.");
}
if (!mjSource.includes("socket.on('sessionUpdated'")) {
  throw new Error("Interface MJ n'écoute pas sessionUpdated.");
}
if (!selectionSource.includes("fetch('/api/session/players')")) {
  throw new Error("Liste des joueurs ne charge pas l'état de session.");
}
if (!selectionSource.includes("socket.on('sessionUpdated'")) {
  throw new Error("Liste des joueurs n'écoute pas sessionUpdated.");
}


// v1.6 mob contract checks
const mobModule = require('../mob');
const serverSourceV16 = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const mjSourceV16 = fs.readFileSync(path.join(__dirname, '..', 'website', 'mj.html'), 'utf8');
const sessionSourceV16 = fs.readFileSync(path.join(__dirname, '..', 'session.js'), 'utf8');

const normalized = mobModule.normaliserMob({ nom: 'Test Mob', hp: { max: 20, current: 20 }, stats: { force: 5 } });
if (!normalized.id || normalized.hp.current !== 20 || normalized.stats.force !== 5) {
  throw new Error('Normalisation mob invalide.');
}
if (!sessionSourceV16.includes('mobs: {}')) throw new Error('Collection mobs absente de la session.');
if (!serverSourceV16.includes("app.get('/api/mobs'")) throw new Error('API mobs absente.');
if (!serverSourceV16.includes("app.post('/api/mob-templates'")) throw new Error('API templates absente.');
if (!serverSourceV16.includes("app.post('/api/mob-templates/:id/spawn'")) throw new Error('API spawn absente.');
if (!mjSourceV16.includes('id="mob-management"')) throw new Error('UI MJ mobs absente.');


// v1.6.3 active mob resource controls checks
const mjSourceV163 = fs.readFileSync(path.join(__dirname, '..', 'website', 'mj.html'), 'utf8');

const aliveMobV163 = mobModule.normaliserMob({
  nom: 'Alive Mob',
  hp: { max: 20, current: 5 },
  mana: { max: 30, current: 15 }
});
if (aliveMobV163.statut !== 'vivant') throw new Error('Un mob avec HP > 0 doit être vivant.');

const deadMobV163 = mobModule.normaliserMob({
  nom: 'Dead Mob',
  hp: { max: 20, current: 0 },
  mana: { max: 30, current: 15 }
});
if (deadMobV163.statut !== 'mort') throw new Error('Un mob à 0 HP doit être mort.');

if (!mjSourceV163.includes('data-a="damage"')) throw new Error('Bouton retrait HP absent.');
if (!mjSourceV163.includes('data-a="drain-mana"')) throw new Error('Bouton retrait Mana absent.');
if (!mjSourceV163.includes('const newHp=Math.max(0,cur-amount)')) throw new Error('Calcul retrait HP absent.');
if (!mjSourceV163.includes('const newMana=Math.max(0,manaCur-amount)')) throw new Error('Calcul retrait Mana absent.');


// v1.6.4 dead mob action checks
const mjSourceV164 = fs.readFileSync(path.join(__dirname, '..', 'website', 'mj.html'), 'utf8');

if (!mjSourceV164.includes("data-a=\"revive\"")) {
  throw new Error('Bouton Réanimer absent.');
}
if (!mjSourceV164.includes("hp:{current:max}")) {
  throw new Error('La réanimation ne restaure pas les HP maximum.');
}
if (!mjSourceV164.includes("mana:{current:manaMax}")) {
  throw new Error('La réanimation ne restaure pas le Mana maximum.');
}
if (!mjSourceV164.includes("isDead")) {
  throw new Error('Condition du mob mort absente.');
}


// v1.7 status management checks
const statusModuleV17=require('../session');
const mjSourceV17=fs.readFileSync(path.join(__dirname,'..','website','mj.html'),'utf8');
const gameSourceV17=fs.readFileSync(path.join(__dirname,'..','website','interface_jeu.html'),'utf8');
const idsV17=statusModuleV17.getStatutsJoueurDisponibles().map(s=>s.id);
for(const id of ['agonie','poison','brulure','paralysie']){
  if(!idsV17.includes(id))throw new Error(`Statut ${id} absent.`);
}
if(statusModuleV17.normaliserStatutsJoueur(['poison','poison']).length!==1)throw new Error('Doublon statut.');
// Les statuts restent gérés par le MJ mais ne sont plus affichés aux joueurs.
if(gameSourceV17.includes('id="player-statuses"'))throw new Error('Les statuts ne doivent plus être affichés au joueur.');
if(!gameSourceV17.includes('id="player-stats"'))throw new Error('Statistiques absentes de l’interface de jeu.');

// v1.8 MJ full player management checks
const serverSourceV18 = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const popupMJSourceV18 = fs.readFileSync(path.join(__dirname, '..', 'website', 'popupmj.js'), 'utf8');
const sessionSourceV18 = fs.readFileSync(path.join(__dirname, '..', 'session.js'), 'utf8');

if (!serverSourceV18.includes("app.post('/api/session/player'")) {
  throw new Error('Endpoint de modification joueur MJ absent.');
}
if (!serverSourceV18.includes("io.emit('gmPlayerUpdated'")) {
  throw new Error('Événement temps réel de modification MJ absent.');
}
if (!popupMJSourceV18.includes('Modifier le joueur')) {
  throw new Error('Bouton de modification MJ absent.');
}
for (const field of ['force','dexterite','magie','constitution','charisme','perception','chance','intelligence']) {
  if (!popupMJSourceV18.includes(`name="${field}"`)) {
    throw new Error(`Champ MJ ${field} absent.`);
  }
}
for (const field of ['spells','sorts_mineurs','attaques_speciales','competences','sac','ceinture','armes']) {
  if (!popupMJSourceV18.includes(field)) {
    throw new Error(`Gestion MJ ${field} absente.`);
  }
}
if (!sessionSourceV18.includes('...joueur,')) {
  throw new Error('La session ne conserve pas tous les paramètres du personnage à son initialisation.');
}

// v1.8.1 integrated player card checks
if (!mjSourceV17.includes('data-a="damage-hp"')) {
  throw new Error('Bouton de retrait des HP absent des cartes joueurs.');
}
if (!mjSourceV17.includes('data-a="drain-mana"')) {
  throw new Error('Bouton de retrait du Mana absent des cartes joueurs.');
}
// Les statuts des personnages ont été retirés de l'interface MJ (ceux des
// créatures restent gérés sur la carte).
if (mjSourceV17.includes('data-a="status-select"') || mjSourceV17.includes('data-remove-player-status')) {
  throw new Error('Les statuts des personnages ne doivent plus apparaître côté MJ.');
}
if (mjSourceV17.includes('id="status-management"')) {
  throw new Error('Ancienne fenêtre globale des statuts encore présente.');
}

// v1.8.2 — restauration des ressources joueurs
if (!mjSourceV17.includes('data-a="heal-hp"')) throw new Error('Bouton + HP absent des joueurs.');
if (!mjSourceV17.includes('data-a="restore-mana"')) throw new Error('Bouton + Mana absent des joueurs.');
if (!mjSourceV17.includes('Math.min(hpMax, hpCurrent + amount)')) throw new Error('Plafond HP joueur absent.');
if (!mjSourceV17.includes('Math.min(manaMax, manaCurrent + amount)')) throw new Error('Plafond Mana joueur absent.');


// v1.8.3 mob creation regression
const fsV183 = require('fs');
const pathV183 = require('path');
const mjSourceV183 = fsV183.readFileSync(pathV183.join(__dirname, '..', 'website', 'mj.html'), 'utf8');
const playerManaButtonsV183 = (mjSourceV183.match(/data-a="restore-mana"/g) || []).length;
if (playerManaButtonsV183 < 2) {
  throw new Error('Les boutons + Mana joueur et mob doivent être présents.');
}
if (!mjSourceV183.includes('data-a="heal"')) {
  throw new Error('Bouton + HP mob absent.');
}
if (!mjSourceV183.includes('/api/mobs')) {
  throw new Error('API de création directe des mobs absente.');
}
if (!mjSourceV183.includes('/api/mob-templates/') || !mjSourceV183.includes('/spawn')) {
  throw new Error('API de création de mob depuis template absente.');
}
if (!mjSourceV183.includes('await loadActiveMobs();')) {
  throw new Error('Le rafraîchissement des mobs actifs après création est absent.');
}


// v1.9.1 separated notes checks
const fsV191 = require('fs');
const pathV191 = require('path');
const sessionSourceV191 = fsV191.readFileSync(pathV191.join(__dirname, '..', 'session.js'), 'utf8');
const serverSourceV191 = fsV191.readFileSync(pathV191.join(__dirname, '..', 'server.js'), 'utf8');
const jeuSourceV191 = fsV191.readFileSync(pathV191.join(__dirname, '..', 'website', 'interface_jeu.html'), 'utf8');
const ficheSourceV191 = fsV191.readFileSync(pathV191.join(__dirname, '..', 'website', 'fiche_perso.html'), 'utf8');
const mjSourceV191 = fsV191.readFileSync(pathV191.join(__dirname, '..', 'website', 'mj.html'), 'utf8');
const tableauSourceV191 = fsV191.readFileSync(pathV191.join(__dirname, '..', 'website', 'tableau.html'), 'utf8');

if (!sessionSourceV191.includes('personalNotes')) throw new Error('Notes personnelles séparées absentes.');
if (!sessionSourceV191.includes('publicNotes')) throw new Error('Notes publiques absentes de la session.');
if (!serverSourceV191.includes('/personal-notes')) throw new Error('API notes personnelles absente.');
if (!serverSourceV191.includes('/api/session/public-notes')) throw new Error('API notes publiques absente.');
if (!jeuSourceV191.includes('id="personal-notes-panel"')) throw new Error('Notes personnelles absentes de Interface de Jeu.');
if (!jeuSourceV191.includes('id="public-notes-panel"')) throw new Error('Notes publiques absentes de Interface de Jeu.');
if (ficheSourceV191.includes('id="private-notes-section"')) throw new Error('Ancienne communication encore présente dans Fiche de Perso.');
if (!mjSourceV191.includes('data-a="personal-notes-view"')) throw new Error('Lecture des notes personnelles absente du MJ.');

// Les messages privés joueur <-> MJ ont été retirés de bout en bout.
if (sessionSourceV191.includes('ajouterMessagePriveJoueur')) throw new Error('Logique des messages privés encore présente.');
if (serverSourceV191.includes("'/api/session/player/:id/private-messages'")) throw new Error('API messages privés encore présente.');
if (jeuSourceV191.includes('private-message')) throw new Error('Messages privés encore présents dans Interface de Jeu.');
if (mjSourceV191.includes('private-thread') || mjSourceV191.includes('privateMessagesUpdated')) {
  throw new Error('Messages privés encore présents côté MJ.');
}
// Les rooms privées restent : elles portent les notes personnelles.
if (!serverSourceV191.includes("socket.join('private-mj')")) throw new Error('Room MJ des notes personnelles absente.');
if (!mjSourceV191.includes('id="public-notes-management"')) throw new Error('Gestion des notes publiques absente du MJ.');

if (!serverSourceV191.includes("function personalNotesWriteAllowed")) throw new Error('Contrôle d’écriture des notes personnelles absent.');
if (!serverSourceV191.includes("Seul le joueur concerné peut modifier ses notes personnelles.")) throw new Error('Protection MJ des notes personnelles absente.');
if (mjSourceV191.includes('data-a="personal-notes-input"')) throw new Error('Le MJ dispose encore d’un champ d’édition des notes personnelles.');
if (mjSourceV191.includes('data-a="personal-notes-save"')) throw new Error('Le MJ dispose encore d’un bouton de modification des notes personnelles.');
if (!mjSourceV191.includes('data-a="personal-notes-view"')) throw new Error('Vue en lecture seule des notes personnelles absente.');

if (!sessionSourceV191.includes('publicNotes: normaliserNotesPubliques(nouvelleSession.publicNotes)')) throw new Error('Export/import des notes publiques absent.');


// v1.10 scene checks
if (!sessionSourceV191.includes('DEFAULT_SCENE')) throw new Error('État de scène V1.10 absent.');
if (!sessionSourceV191.includes('moveSceneToken')) throw new Error('Déplacement des tokens absent.');
if (!sessionSourceV191.includes('resetScenePositions')) throw new Error('Réinitialisation de la scène absente.');
if (!serverSourceV191.includes('/api/session/scene')) throw new Error('API scène absente.');
if (!serverSourceV191.includes('sceneMoveToken')) throw new Error('Socket déplacement de token absent.');
if (!serverSourceV191.includes('clearDrawings')) throw new Error('Effacement des dessins temps réel absent.');
const navbarSourceV191 = fsV191.readFileSync(pathV191.join(__dirname, '..', 'website', 'navbar.js'), 'utf8');
if (!navbarSourceV191.includes('tableau.html')) throw new Error('Lien tableau absent de la navigation.');


// v1.10.1 mob visibility checks
if (!sessionSourceV191.includes('visibleToPlayers')) throw new Error('État de visibilité des mobs absent.');
if (!sessionSourceV191.includes('setMobSceneVisibility')) throw new Error('Fonction de visibilité des mobs absente.');
if (!serverSourceV191.includes('/api/session/scene/mob/:id/visibility')) throw new Error('API de visibilité des mobs absente.');
if (!serverSourceV191.includes('Seul le MJ peut modifier la visibilité des mobs.')) throw new Error('Protection MJ de la visibilité absente.');
if (!tableauSourceV191.includes('data-scene-visibility')) throw new Error('Contrôle de visibilité absent du tableau de scène.');
if (!tableauSourceV191.includes('Cacher aux joueurs')) throw new Error('Bouton Cacher aux joueurs absent.');
if (!tableauSourceV191.includes('Montrer aux joueurs')) throw new Error('Bouton Montrer aux joueurs absent.');


// v1.10.2 visibility boolean regression checks
if (!serverSourceV191.includes("typeof req.body?.visible !== 'boolean'")) {
  throw new Error('Validation booléenne de la visibilité absente.');
}
if (!serverSourceV191.includes("const visible = req.body.visible")) {
  throw new Error('Lecture stricte de la visibilité absente.');
}


// v1.10.3 server-side visibility toggle checks
if (!serverSourceV191.includes("/api/session/scene/mob/:id/toggle-visibility")) {
  throw new Error('Endpoint de bascule serveur de visibilité absent.');
}
if (!tableauSourceV191.includes("toggle-visibility")) {
  throw new Error('Le bouton de visibilité n’utilise pas la bascule serveur.');
}

// v1.11 inventory & equipment checks
const joueurSourceV111 = fs.readFileSync(path.join(__dirname, '..', 'joueur.js'), 'utf8');
const sessionSourceV111 = fs.readFileSync(path.join(__dirname, '..', 'session.js'), 'utf8');
const ficheSourceV111 = fs.readFileSync(path.join(__dirname, '..', 'website', 'fiche_perso.html'), 'utf8');
const mjPopupSourceV111 = fs.readFileSync(path.join(__dirname, '..', 'website', 'popupmj.js'), 'utf8');
const createPlayerSourceV111 = fs.readFileSync(path.join(__dirname, '..', 'website', 'create_player.html'), 'utf8');
const interfaceJeuSourceV111 = fs.readFileSync(path.join(__dirname, '..', 'website', 'interface_jeu.html'), 'utf8');

const { normaliserInventaire } = require('../joueur');
const inventoryV111 = normaliserInventaire([
  { id: 'item_test', nom: 'Potion', type: 'Potion', quantite: 2, emplacement: 'Ceinture', equipe: true, description: 'Soin' },
  { nom: 'Épée', type: 'Arme', quantite: 1, emplacement: 'Arme principale', equipe: true }
]);
if (inventoryV111.length !== 2) throw new Error('Normalisation inventaire invalide.');
if (!inventoryV111[1].id) throw new Error('Un objet d’inventaire doit recevoir un ID stable.');
if (inventoryV111[0].equipe !== true || inventoryV111[0].quantite !== 2) throw new Error('Équipement/quantité inventaire invalide.');
if (!joueurSourceV111.includes('normaliserInventaire')) throw new Error('Normalisation inventaire absente du modèle joueur.');
if (!sessionSourceV111.includes('inventaire: normaliserInventaireSession')) throw new Error('Inventaire absent de la session active.');
if (!ficheSourceV111.includes('id="inventory-editor"')) throw new Error('Éditeur inventaire absent de la fiche joueur.');
if (!ficheSourceV111.includes('function getInventaire()')) throw new Error('Collecte inventaire absente de la fiche joueur.');
if (!ficheSourceV111.includes('inventory-equipped-check')) throw new Error('Contrôle équipement absent de la fiche joueur.');
if (!mjPopupSourceV111.includes('setupMJInventoryEditor')) throw new Error('Éditeur graphique inventaire MJ absent.');
if (!createPlayerSourceV111.includes('inventaire: []')) throw new Error('Initialisation inventaire création joueur absente.');
if (!interfaceJeuSourceV111.includes('inventaire: safeJSONParse')) throw new Error('Inventaire non conservé dans le flux Interface de Jeu.');
console.log('PASS: V1.11 inventaire structuré + équipement + persistance session');


// v1.11.1 graphical inventory checks
const popupMJSourceV111 = fsV191.readFileSync(pathV191.join(__dirname, '..', 'website', 'popupmj.js'), 'utf8');
const styleSourceV111 = fsV191.readFileSync(pathV191.join(__dirname, '..', 'website', 'style.css'), 'utf8');
if (!popupMJSourceV111.includes('setupMJInventoryEditor')) throw new Error('Éditeur graphique de l’inventaire MJ absent.');
if (!popupMJSourceV111.includes('mj-add-inventory-item')) throw new Error('Bouton Ajouter un objet absent.');
if (!popupMJSourceV111.includes('collectMJInventory')) throw new Error('Collecte de l’inventaire graphique absente.');
if (popupMJSourceV111.includes('name="inventaire" spellcheck="false"')) throw new Error('Ancien éditeur JSON de l’inventaire encore présent.');
if (!styleSourceV111.includes('.mj-inventory-table')) throw new Error('Styles de l’inventaire MJ absents.');


// v1.11.2 bidirectional inventory/equipment checks
const serverSourceV112 = fsV191.readFileSync(pathV191.join(__dirname, '..', 'server.js'), 'utf8');
const sessionSourceV112 = fsV191.readFileSync(pathV191.join(__dirname, '..', 'session.js'), 'utf8');
const ficheSourceV112 = fsV191.readFileSync(pathV191.join(__dirname, '..', 'website', 'fiche_perso.html'), 'utf8');

if (!serverSourceV112.includes("const donneesPersistantesMJ = {}")) {
  throw new Error('La persistance MJ de l’inventaire/équipement est absente.');
}
for (const champ of ['inventaire', 'armes', 'armure', 'sac', 'ceinture']) {
  if (!serverSourceV112.includes(`'${champ}'`)) {
    throw new Error(`Le champ ${champ} n’est pas synchronisé depuis l’éditeur MJ.`);
  }
}
if (!sessionSourceV112.includes("inventaire: normaliserInventaireSession(etatSession.inventaire)")) {
  throw new Error('L’inventaire n’est pas exporté de la session vers la fiche.');
}
if (!sessionSourceV112.includes("armes: Array.isArray(etatSession.armes) ? etatSession.armes : []")) {
  throw new Error('Les armes ne sont pas exportées de la session vers la fiche.');
}
if (!ficheSourceV112.includes("inventaire: getInventaire()")) {
  throw new Error('La fiche de personnage ne sauvegarde pas son inventaire.');
}


// ======================================================================
// V1.12 — Reconnexion & resynchronisation de l'état autoritaire
// ======================================================================
const serverSourceV112Reconnect = fsV191.readFileSync(
  pathV191.join(__dirname, '..', 'server.js'),
  'utf8'
);
const interfaceSourceV112Reconnect = fsV191.readFileSync(
  pathV191.join(__dirname, '..', 'website', 'interface_jeu.html'),
  'utf8'
);
const mjSourceV112Reconnect = fsV191.readFileSync(
  pathV191.join(__dirname, '..', 'website', 'mj.html'),
  'utf8'
);
const tableauSourceV112Reconnect = fsV191.readFileSync(
  pathV191.join(__dirname, '..', 'website', 'tableau.html'),
  'utf8'
);
const selectSourceV112Reconnect = fsV191.readFileSync(
  pathV191.join(__dirname, '..', 'website', 'selecte_player.html'),
  'utf8'
);

if (!serverSourceV112Reconnect.includes('function buildAuthoritativeSocketSnapshot')) {
  throw new Error('V1.12 : snapshot autoritaire absent du serveur.');
}
if (!serverSourceV112Reconnect.includes("socket.on('stateSyncRequest'")) {
  throw new Error('V1.12 : demande de resynchronisation Socket.IO absente.');
}
if (!serverSourceV112Reconnect.includes("socket.emit('stateSync'")) {
  throw new Error('V1.12 : réponse stateSync absente.');
}
for (const required of [
  'getPublicNotes()',
  "getSceneState('mj')",
  "getSceneState('player', playerId)",
  'getSessionMobs()'
]) {
  if (!serverSourceV112Reconnect.includes(required)) {
    throw new Error(`V1.12 : snapshot incomplet, élément absent : ${required}`);
  }
}
if (!interfaceSourceV112Reconnect.includes("socket.emit('stateSyncRequest')")) {
  throw new Error('V1.12 : interface joueur ne redemande pas l’état après reconnexion.');
}
if (!interfaceSourceV112Reconnect.includes("socket.on('stateSync'")) {
  throw new Error('V1.12 : interface joueur ne traite pas stateSync.');
}
if (!mjSourceV112Reconnect.includes("socket.emit('stateSyncRequest')")) {
  throw new Error('V1.12 : interface MJ ne redemande pas l’état après reconnexion.');
}
if (!mjSourceV112Reconnect.includes("socket.on('stateSync'")) {
  throw new Error('V1.12 : interface MJ ne traite pas stateSync.');
}
if (!tableauSourceV112Reconnect.includes("socket.emit('stateSyncRequest')")) {
  throw new Error('V1.12 : tableau ne redemande pas l’état après reconnexion.');
}
if (!tableauSourceV112Reconnect.includes("socket.on('stateSync'")) {
  throw new Error('V1.12 : tableau ne traite pas stateSync.');
}
if (!selectSourceV112Reconnect.includes("socket.emit('stateSyncRequest')")) {
  throw new Error('V1.12 : sélection joueur ne redemande pas l’état après reconnexion.');
}

console.log('PASS: V1.12 reconnect + authoritative state resynchronization');
