// session.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { creerDepot, cheminDonnees } = require('./storage');
const initiativeModele = require('./initiative');

const cheminFichier = cheminDonnees('session.json');

const STATUTS_JOUEUR = Object.freeze({
  agonie: { id: 'agonie', nom: 'Agonie', automatique: true },
  poison: { id: 'poison', nom: 'Poison', automatique: false },
  brulure: { id: 'brulure', nom: 'Brûlure', automatique: false },
  paralysie: { id: 'paralysie', nom: 'Paralysie', automatique: false }
});
function getStatutsJoueurDisponibles(){return Object.values(STATUTS_JOUEUR).map(s=>({...s}));}
function normaliserStatutsJoueur(statuts){
  if(!Array.isArray(statuts))return [];
  const out=[],seen=new Set();
  for(const item of statuts){
    const id=typeof item==='string'?item:item?.id;
    if(!STATUTS_JOUEUR[id]||seen.has(id))continue;
    seen.add(id);out.push({id,nom:STATUTS_JOUEUR[id].nom,appliedAt:item?.appliedAt||new Date().toISOString()});
  }
  return out;
}

function normaliserInventaireSession(inventaire){
  if(!Array.isArray(inventaire)) return [];
  return inventaire
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
      nom: typeof item.nom === 'string' ? item.nom.trim() : '',
      type: typeof item.type === 'string' ? item.type : 'Objet',
      quantite: Math.max(1, Number.isFinite(Number(item.quantite)) ? Number(item.quantite) : 1),
      emplacement: typeof item.emplacement === 'string' ? item.emplacement : '',
      equipe: item.equipe === true,
      description: typeof item.description === 'string' ? item.description : ''
    }))
    .filter(item => item.nom.length > 0);
}

function normaliserNotesPersonnelles(notes){
  return typeof notes === 'string' ? notes : '';
}

function normaliserNotesPubliques(notes){
  if(!Array.isArray(notes)) return [];
  return notes
    .filter(item => item && typeof item === 'object' && typeof item.content === 'string')
    .map(item => ({
      id: item.id || crypto.randomUUID(),
      title: typeof item.title === 'string' ? item.title.trim() : '',
      content: item.content.trim(),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
    }))
    .filter(item => item.content.length > 0 || item.title.length > 0);
}

/**
 * Ressource {current, max} : la valeur actuelle ne descend pas sous 0 et ne
 * dépasse jamais le maximum (PV, mana, durabilité, protection). Les champs
 * absents sont laissés tels quels.
 */
function bornerRessource(ressource){
  const borne={...ressource};
  const max=Number(borne.max);
  if(borne.current===undefined||!Number.isFinite(max))return borne;
  const actuel=Number(borne.current);
  borne.current=Number.isFinite(actuel)?Math.max(0,Math.min(actuel,Math.max(0,max))):0;
  return borne;
}

/** Jets de survie : { reussi: [b, b, b], echec: [b, b, b] }. */
function normaliserSurvie(survie){
  const trois=liste=>[0,1,2].map(i=>Array.isArray(liste)&&liste[i]===true);
  return {reussi:trois(survie?.reussi),echec:trois(survie?.echec)};
}

function synchroniserAgonie(etat){
  const hp=Number(etat?.hp?.current??0);
  let statuts=normaliserStatutsJoueur(etat?.statuts);
  if(hp<=0&&!statuts.some(s=>s.id==='agonie'))statuts.push({id:'agonie',nom:'Agonie',appliedAt:new Date().toISOString()});
  if(hp>0)statuts=statuts.filter(s=>s.id!=='agonie');
  return statuts;
}



const DEFAULT_SCENE = Object.freeze({
  width: 1200,
  height: 675,
  gridSize: 50,
  tokens: {}
});

function defaultScenePosition(index) {
  const columns = 6;
  const col = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: Math.min(0.92, 0.12 + col * 0.15),
    y: Math.min(0.90, 0.18 + row * 0.18)
  };
}

function buildSceneTokens(existingTokens = {}) {
  const tokens = {...existingTokens};
  const players = Object.values(session.players || {});
  players.forEach((player, index) => {
    const id = `player:${player.id}`;
    if (!tokens[id]) {
      const pos = defaultScenePosition(index);
      tokens[id] = {id, type:'player', entityId:player.id, x:pos.x, y:pos.y};
    }
  });

  const mobs = Object.values(session.mobs || {});
  mobs.forEach((mob, index) => {
    const id = `mob:${mob.id}`;
    if (!tokens[id]) {
      const pos = defaultScenePosition(players.length + index);
      tokens[id] = {id, type:'mob', entityId:mob.id, x:pos.x, y:pos.y, visibleToPlayers:true};
    }
  });

  const validIds = new Set([
    ...players.map(player => `player:${player.id}`),
    ...mobs.map(mob => `mob:${mob.id}`)
  ]);
  Object.keys(tokens).forEach(id => {
    if (!validIds.has(id)) delete tokens[id];
  });
  return tokens;
}

function getSceneState(viewerRole='viewer', viewerPlayerId=null) {
  const raw = session.scene || DEFAULT_SCENE;
  const allTokens = buildSceneTokens(raw.tokens || {});
  const isMj = viewerRole === 'mj';

  // Les mobs cachés restent dans la session et restent visibles par le MJ,
  // mais ne sont jamais envoyés aux joueurs.
  const visibleTokens = Object.fromEntries(
    Object.entries(allTokens).filter(([, token]) =>
      token.type !== 'mob' || token.visibleToPlayers !== false || isMj
    )
  );

  const visibleMobIds = new Set(
    Object.values(visibleTokens)
      .filter(token => token.type === 'mob')
      .map(token => token.entityId)
  );

  return {
    width: raw.width || DEFAULT_SCENE.width,
    height: raw.height || DEFAULT_SCENE.height,
    gridSize: raw.gridSize || DEFAULT_SCENE.gridSize,
    tokens: visibleTokens,
    entities: {
      players: Object.values(session.players || {}).map(player => ({
        id: player.id,
        nom: player.nom || 'Joueur',
        hp: player.hp || {current:0,max:0},
        statuts: player.statuts || []
      })),
      mobs: Object.values(session.mobs || {})
        .filter(mob => isMj || visibleMobIds.has(mob.id))
        .map(mob => ({
          id: mob.id,
          nom: mob.nom || 'Mob',
          hp: mob.hp || {current:0,max:0},
          mana: mob.mana || {current:0,max:0},
          statut: mob.statut || 'vivant'
        }))
    }
  };
}

function setMobSceneVisibility(mobId, visible) {
  const scene = ensureSceneState();
  const tokenId = `mob:${mobId}`;
  const token = scene.tokens[tokenId];
  if (!token) return {success:false,message:'Mob introuvable dans la scène.'};

  const nouvelleSession = {
    ...session,
    scene: {
      ...session.scene,
      tokens: {
        ...session.scene.tokens,
        [tokenId]: {
          ...session.scene.tokens[tokenId],
          visibleToPlayers: Boolean(visible)
        }
      }
    },
    lastSaved:new Date().toISOString()
  };

  if(!ecrireSession(nouvelleSession)) {
    return {success:false,message:'Impossible de sauvegarder la visibilité du mob.'};
  }

  session=nouvelleSession;
  return {
    success:true,
    mobId,
    visibleToPlayers:Boolean(visible)
  };
}

function ensureSceneState() {
  const raw = session.scene || DEFAULT_SCENE;
  const tokens = buildSceneTokens(raw.tokens || {});
  const next = {
    width: raw.width || DEFAULT_SCENE.width,
    height: raw.height || DEFAULT_SCENE.height,
    gridSize: raw.gridSize || DEFAULT_SCENE.gridSize,
    tokens
  };
  if (JSON.stringify(session.scene || {}) === JSON.stringify(next)) return getSceneState();

  const nouvelleSession = {...session, scene:next, lastSaved:new Date().toISOString()};
  if (!ecrireSession(nouvelleSession)) return getSceneState();
  session = nouvelleSession;
  return getSceneState();
}

function moveSceneToken(tokenId, x, y, role, playerId) {
  const scene = ensureSceneState();
  const token = scene.tokens[tokenId];
  if (!token) return {success:false,message:'Token introuvable.'};

  const allowed = role === 'mj' ||
    (role === 'player' && token.type === 'player' && token.entityId === playerId);
  if (!allowed) return {success:false,message:'Vous ne pouvez pas déplacer ce token.'};

  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    return {success:false,message:'Position invalide.'};
  }

  const clampedX=Math.max(0,Math.min(1,nx));
  const clampedY=Math.max(0,Math.min(1,ny));
  const nouvelleSession={
    ...session,
    scene:{
      ...session.scene,
      tokens:{
        ...session.scene.tokens,
        [tokenId]:{...session.scene.tokens[tokenId],x:clampedX,y:clampedY}
      }
    },
    lastSaved:new Date().toISOString()
  };
  if(!ecrireSession(nouvelleSession)) return {success:false,message:'Impossible de sauvegarder la position.'};
  session=nouvelleSession;
  return {success:true,scene:getSceneState()};
}

function resetScenePositions() {
  const scene=ensureSceneState();
  const ids=Object.keys(scene.tokens);
  const tokens={};
  ids.forEach((id,index)=>{
    const pos=defaultScenePosition(index);
    tokens[id]={...scene.tokens[id],x:pos.x,y:pos.y};
  });
  const nouvelleSession={
    ...session,
    scene:{...session.scene,tokens},
    lastSaved:new Date().toISOString()
  };
  if(!ecrireSession(nouvelleSession)) return {success:false,message:'Impossible de réinitialiser la scène.'};
  session=nouvelleSession;
  return {success:true,scene:getSceneState()};
}

let session = {
  id: 'session_active',
  lastSaved: null,
  players: {},
  mobs: {},
  publicNotes: [],
  scene: {...DEFAULT_SCENE},
  // V1.13 : identifiant de la carte active dans maps.json.
  // Les cartes elles-mêmes vivent hors de la session : seul le choix de
  // la carte en cours d'utilisation appartient à la partie.
  activeMapId: null,
  // Vue affichée par l'Écran partagé, choisie par le MJ.
  ecranVue: 'carte',
  // Ordre d'initiative du combat en cours (voir initiative.js).
  initiative: null
};

const VUES_ECRAN = ['carte', 'tableau'];
const normaliserVueEcran = vue => (VUES_ECRAN.includes(vue) ? vue : 'carte');

function lireSession() {
  if (!fs.existsSync(cheminFichier)) {
    return;
  }

  try {
    const contenu = fs.readFileSync(cheminFichier, 'utf-8');
    const donnees = JSON.parse(contenu);

    if (!donnees || typeof donnees !== 'object' || Array.isArray(donnees)) {
      throw new Error('session.json doit contenir un objet.');
    }

    const loadedPlayers = donnees.players && typeof donnees.players === 'object'
      ? donnees.players
      : {};

    Object.values(loadedPlayers).forEach(player => {
      // Les messages privés (privateMessages, ex-privateNotes) ont été
      // retirés : ces champs ne sont plus lus, mais laissés en place.
      player.personalNotes = normaliserNotesPersonnelles(player.personalNotes);
      player.inventaire = normaliserInventaireSession(player.inventaire);
    });

    session = {
      id: donnees.id || 'session_active',
      lastSaved: donnees.lastSaved || null,
      players: loadedPlayers,
      mobs: donnees.mobs && typeof donnees.mobs === 'object'
        ? donnees.mobs
        : {},
      publicNotes: normaliserNotesPubliques(donnees.publicNotes),
      scene: {
        width: donnees.scene?.width || DEFAULT_SCENE.width,
        height: donnees.scene?.height || DEFAULT_SCENE.height,
        gridSize: donnees.scene?.gridSize || DEFAULT_SCENE.gridSize,
        tokens: donnees.scene?.tokens && typeof donnees.scene.tokens === 'object'
          ? donnees.scene.tokens
          : {}
      },
      activeMapId: typeof donnees.activeMapId === 'string' && donnees.activeMapId
        ? donnees.activeMapId
        : null,
      ecranVue: normaliserVueEcran(donnees.ecranVue),
      initiative: initiativeModele.normaliserEtat(donnees.initiative)
    };
  } catch (err) {
    console.error("Erreur lors de la lecture de session.json:", err);
  }
}

// V1.13.5 : écriture atomique factorisée dans storage.js.
// L'écriture reste SYNCHRONE — session.json fait une quinzaine de kilo-octets
// et de nombreux appelants dépendent du booléen retourné pour décider s'ils
// valident ou non la mutation en mémoire.
const depotSession = creerDepot(cheminFichier, { etiquette: 'session.json' });

function ecrireSession(nouvelleSession) {
  return depotSession.ecrire(JSON.stringify(nouvelleSession, null, 2));
}

function extraireEtatSessionDepuisPersonnage(joueur) {
  // La session conserve l'intégralité des paramètres du personnage.
  // Les champs normalisés ci-dessous garantissent une structure stable
  // pour les données utilisées directement pendant la partie.
  return {
    ...joueur,
    statuts: synchroniserAgonie({ hp: joueur.hp }),
    id: joueur.id,
    nom: joueur.nom || '',
    classe: joueur.classe || '',
    race: joueur.race || '',
    niveau: joueur.niveau ?? 1,

    // Valeurs utilisables directement pendant la partie.
    hp: {
      max: joueur.hp?.max ?? 0,
      current: joueur.hp?.current ?? 0
    },
    mana: {
      max: joueur.mana?.max ?? 0,
      current: joueur.mana?.current ?? 0
    },
    armure: {
      type: joueur.armure?.type || '',
      resistance: joueur.armure?.resistance || '',
      durabilite: {
        max: joueur.armure?.durabilite?.max ?? 0,
        current: joueur.armure?.durabilite?.current ?? 0
      },
      protection: {
        max: joueur.armure?.protection?.max ?? 0,
        current: joueur.armure?.protection?.current ?? 0
      }
    },
    bonus_vie: joueur.bonus_vie ?? 0,
    intox: joueur.intox ?? 0,

    // Jets de survie : trois cases « réussi » et trois « échec ».
    survie: normaliserSurvie(joueur.survie),

    // Métadonnées utiles à l'interface de jeu.
    stats: { ...(joueur.stats || {}) },

    // Inventaire structuré du personnage.
    inventaire: normaliserInventaireSession(joueur.inventaire),

    // Notes personnelles du joueur.
    personalNotes: normaliserNotesPersonnelles(joueur.personalNotes),

    lastSaved: null
  };
}

function validerSessionImport(donnees) {
  if (!donnees || typeof donnees !== 'object' || Array.isArray(donnees)) {
    return { valid: false, message: 'La session importée doit être un objet.' };
  }

  if (typeof donnees.id !== 'string' || !donnees.id) {
    return { valid: false, message: 'Identifiant de session manquant.' };
  }

  if (!donnees.players || typeof donnees.players !== 'object' || Array.isArray(donnees.players)) {
    return { valid: false, message: 'La session importée ne contient pas de joueurs valides.' };
  }

  for (const [id, joueur] of Object.entries(donnees.players)) {
    if (!joueur || typeof joueur !== 'object' || Array.isArray(joueur)) {
      return { valid: false, message: `État invalide pour le joueur ${id}.` };
    }

    if (joueur.id !== id) {
      return { valid: false, message: `L'ID du joueur ${id} ne correspond pas à sa clé de session.` };
    }

    if (joueur.hp && typeof joueur.hp !== 'object') {
      return { valid: false, message: `HP invalide pour le joueur ${id}.` };
    }

    if (joueur.mana && typeof joueur.mana !== 'object') {
      return { valid: false, message: `Mana invalide pour le joueur ${id}.` };
    }

    if (joueur.armure && typeof joueur.armure !== 'object') {
      return { valid: false, message: `Armure invalide pour le joueur ${id}.` };
    }

    if (joueur.inventaire !== undefined && !Array.isArray(joueur.inventaire)) {
      return { valid: false, message: `Inventaire invalide pour le joueur ${id}.` };
    }
  }

  if (donnees.mobs !== undefined) {
    if (typeof donnees.mobs !== 'object' || Array.isArray(donnees.mobs)) {
      return { valid: false, message: 'Les mobs de la session doivent être un objet.' };
    }

    for (const [id, mob] of Object.entries(donnees.mobs)) {
      if (!mob || typeof mob !== 'object' || Array.isArray(mob)) {
        return { valid: false, message: `État invalide pour le mob ${id}.` };
      }
      if (mob.id !== id) {
        return { valid: false, message: `L'ID du mob ${id} ne correspond pas à sa clé de session.` };
      }
      if (!mob.nom || typeof mob.nom !== 'string') {
        return { valid: false, message: `Nom invalide pour le mob ${id}.` };
      }
      if (mob.hp !== undefined && (typeof mob.hp !== 'object' || Array.isArray(mob.hp))) {
        return { valid: false, message: `HP invalide pour le mob ${id}.` };
      }
    }
  }

  if (donnees.activeMapId !== undefined &&
      donnees.activeMapId !== null &&
      typeof donnees.activeMapId !== 'string') {
    return { valid: false, message: 'La carte active de la session est invalide.' };
  }

  return { valid: true };
}

/**
 * Remplace entièrement l'état de la partie active.
 * L'opération est utilisée uniquement pour l'import explicite d'une session.
 */
function importerSession(nouvelleSession) {
  const validation = validerSessionImport(nouvelleSession);

  if (!validation.valid) {
    return { success: false, message: validation.message };
  }

  const sessionNormalisee = {
    id: nouvelleSession.id,
    lastSaved: nouvelleSession.lastSaved || new Date().toISOString(),
    players: Object.fromEntries(
      Object.entries(nouvelleSession.players).map(([id, joueur]) => [
        id,
        {...joueur, inventaire: normaliserInventaireSession(joueur.inventaire)}
      ])
    ),
    mobs: nouvelleSession.mobs && typeof nouvelleSession.mobs === 'object'
      ? nouvelleSession.mobs
      : {},
    publicNotes: normaliserNotesPubliques(nouvelleSession.publicNotes),
    scene: {
      width: nouvelleSession.scene?.width || DEFAULT_SCENE.width,
      height: nouvelleSession.scene?.height || DEFAULT_SCENE.height,
      gridSize: nouvelleSession.scene?.gridSize || DEFAULT_SCENE.gridSize,
      tokens: nouvelleSession.scene?.tokens && typeof nouvelleSession.scene.tokens === 'object'
        ? nouvelleSession.scene.tokens
        : {}
    },
    // La carte active est un simple pointeur : si la carte n'existe pas
    // sur ce serveur, l'interface MJ proposera d'en choisir une autre.
    activeMapId: typeof nouvelleSession.activeMapId === 'string' && nouvelleSession.activeMapId
      ? nouvelleSession.activeMapId
      : null,
    ecranVue: normaliserVueEcran(nouvelleSession.ecranVue),
    initiative: initiativeModele.normaliserEtat(nouvelleSession.initiative)
  };

  if (!ecrireSession(sessionNormalisee)) {
    return {
      success: false,
      message: "Impossible d'écrire la session importée."
    };
  }

  session = sessionNormalisee;

  return {
    success: true,
    session
  };
}

function getSession() {
  return session;
}

function getSessionPlayerById(id) {
  return session.players[id] || null;
}

function ensureSessionPlayer(joueur) {
  if (!joueur || !joueur.id) {
    throw new Error('Un joueur avec un ID stable est requis.');
  }

  if (!session.players[joueur.id]) {
    const nouveauEtat = extraireEtatSessionDepuisPersonnage(joueur);
    const nouvelleSession = {
      ...session,
      players: {
        ...session.players,
        [joueur.id]: nouveauEtat
      }
    };

    if (!ecrireSession(nouvelleSession)) {
      throw new Error("Impossible d'initialiser l'état de session du joueur.");
    }

    session = nouvelleSession;
  }

  const joueurSession = session.players[joueur.id];
  const statuts = synchroniserAgonie(joueurSession);
  if (JSON.stringify(statuts) !== JSON.stringify(joueurSession.statuts || [])) {
    const nouvelleSession = {
      ...session,
      players: {...session.players,[joueur.id]: {...joueurSession, statuts, lastSaved:new Date().toISOString()}},
      lastSaved:new Date().toISOString()
    };
    if(ecrireSession(nouvelleSession)) session=nouvelleSession;
  }
  return session.players[joueur.id];
}

/**
 * Quand la Fiche de Perso est sauvegardée, les données de personnage
 * deviennent la nouvelle base de la session.
 *
 * C'est volontairement un flux à sens unique :
 *
 * Fiche de Perso -> Session de Jeu
 *
 * L'inverse n'est jamais effectué automatiquement.
 */
function synchroniserSessionDepuisPersonnage(joueur) {
  if (!joueur || !joueur.id) {
    return false;
  }

  // Règle : la fiche porte la DÉFINITION du personnage (stats, maximums,
  // sorts, inventaire...) ; la partie porte l'ÉTAT DE JEU. Enregistrer la
  // fiche ne doit donc jamais écraser les PV, le mana, la durabilité, la
  // protection, la vie bonus, l'intoxication ni les jets de survie en cours :
  // ils sont conservés, bornés aux éventuels nouveaux maximums.
  const ancienEtat = session.players[joueur.id];
  const definition = extraireEtatSessionDepuisPersonnage(joueur);
  const nouvelEtat = {
    ...(ancienEtat || {}),
    ...definition,
    lastSaved: new Date().toISOString()
  };

  if (ancienEtat) {
    const garder = (nouveau, ancien) =>
      bornerRessource({ ...nouveau, current: ancien?.current ?? nouveau.current });
    nouvelEtat.hp = garder(definition.hp, ancienEtat.hp);
    nouvelEtat.mana = garder(definition.mana, ancienEtat.mana);
    nouvelEtat.armure = {
      ...definition.armure,
      durabilite: garder(definition.armure.durabilite, ancienEtat.armure?.durabilite),
      protection: garder(definition.armure.protection, ancienEtat.armure?.protection)
    };
    nouvelEtat.bonus_vie = ancienEtat.bonus_vie ?? definition.bonus_vie;
    nouvelEtat.intox = ancienEtat.intox ?? definition.intox;
    if (ancienEtat.survie) nouvelEtat.survie = ancienEtat.survie;
    nouvelEtat.statuts = synchroniserAgonie({ hp: nouvelEtat.hp, statuts: ancienEtat.statuts });
  }

  const nouvelleSession = {
    ...session,
    players: {
      ...session.players,
      [joueur.id]: nouvelEtat
    },
    lastSaved: new Date().toISOString()
  };

  if (!ecrireSession(nouvelleSession)) {
    return false;
  }

  session = nouvelleSession;
  return true;
}

/**
 * Sauvegarde d'une modification provenant de l'Interface de Jeu.
 *
 * Cette fonction ne touche JAMAIS data.json.
 */
/**
 * Prépare les données de session qui peuvent être importées manuellement
 * dans la Fiche de Perso.
 */
function extraireDonneesPersonnageDepuisSession(etatSession) {
  return {
    hp: {
      max: etatSession.hp?.max ?? 0,
      current: etatSession.hp?.current ?? 0
    },
    mana: {
      max: etatSession.mana?.max ?? 0,
      current: etatSession.mana?.current ?? 0
    },
    armure: {
      type: etatSession.armure?.type || '',
      resistance: etatSession.armure?.resistance || '',
      durabilite: {
        max: etatSession.armure?.durabilite?.max ?? 0,
        current: etatSession.armure?.durabilite?.current ?? 0
      },
      protection: {
        max: etatSession.armure?.protection?.max ?? 0,
        current: etatSession.armure?.protection?.current ?? 0
      }
    },
    bonus_vie: etatSession.bonus_vie ?? 0,
    intox: etatSession.intox ?? 0,

    // Inventaire et équipement font partie de l'état du personnage.
    // Ils sont donc inclus lorsque le MJ importe l'état de la partie
    // dans la Fiche de Perso.
    sac: etatSession.sac ?? '',
    ceinture: etatSession.ceinture ?? '',
    inventaire: normaliserInventaireSession(etatSession.inventaire),
    armes: Array.isArray(etatSession.armes) ? etatSession.armes : []
  };
}

function getDonneesPersonnageDepuisSession(id) {
  const etatSession = getSessionPlayerById(id);
  return etatSession ? extraireDonneesPersonnageDepuisSession(etatSession) : null;
}

function sauvegarderEtatSession(id, nouvellesDonnees) {
  if (!id) {
    return false;
  }

  const joueurSession = session.players[id];

  if (!joueurSession) {
    return false;
  }

  const hp = bornerRessource({ ...(joueurSession.hp || {}), ...(nouvellesDonnees.hp || {}) });

  const nouvelEtat = {
    ...joueurSession,
    ...nouvellesDonnees,
    id,
    hp,
    mana: bornerRessource({
      ...(joueurSession.mana || {}),
      ...(nouvellesDonnees.mana || {})
    }),
    ...(nouvellesDonnees.survie !== undefined
      ? { survie: normaliserSurvie(nouvellesDonnees.survie) }
      : {}),
    statuts: synchroniserAgonie({
      ...joueurSession,
      ...nouvellesDonnees,
      hp
    }),
    armure: {
      ...(joueurSession.armure || {}),
      ...(nouvellesDonnees.armure || {}),
      durabilite: bornerRessource({
        ...((joueurSession.armure && joueurSession.armure.durabilite) || {}),
        ...((nouvellesDonnees.armure && nouvellesDonnees.armure.durabilite) || {})
      }),
      protection: bornerRessource({
        ...((joueurSession.armure && joueurSession.armure.protection) || {}),
        ...((nouvellesDonnees.armure && nouvellesDonnees.armure.protection) || {})
      })
    },
    lastSaved: new Date().toISOString()
  };

  const nouvelleSession = {
    ...session,
    players: {
      ...session.players,
      [id]: nouvelEtat
    },
    lastSaved: new Date().toISOString()
  };

  if (!ecrireSession(nouvelleSession)) {
    return false;
  }

  session = nouvelleSession;
  return true;
}





// ---------------------------------------------------------------------------
// V1.13.8 — Statuts sur les créatures.
//
// Même catalogue que les personnages (STATUTS_JOUEUR) : Poison, Brûlure,
// Paralysie s'appliquent aussi bien à un gobelin qu'à un joueur, et il serait
// absurde d'en maintenir deux listes.
//
// Une nuance toutefois : synchroniserAgonie() est propre aux personnages —
// l'agonie y traduit automatiquement 0 PV. Pour une créature, c'est le champ
// `statut` (vivant / mort), déjà calculé par mob.js, qui joue ce rôle.
// L'agonie n'est donc pas proposée aux créatures.
// ---------------------------------------------------------------------------

function ajouterStatutMob(id, statutId){
  const mob=session.mobs?.[id], statut=STATUTS_JOUEUR[statutId];
  if(!mob||!statut)return {success:false,message:'Créature ou statut introuvable.'};
  if(statutId==='agonie')return {success:false,message:'L’agonie ne s’applique qu’aux personnages.'};

  const statuts=normaliserStatutsJoueur(mob.statuts);
  if(statuts.some(s=>s.id===statutId))return {success:false,message:'Ce statut est déjà appliqué.'};
  statuts.push({id:statut.id,nom:statut.nom,appliedAt:new Date().toISOString()});

  const ns={...session,mobs:{...session.mobs,[id]:{...mob,statuts,updatedAt:new Date().toISOString()}},lastSaved:new Date().toISOString()};
  if(!ecrireSession(ns))return {success:false,message:'Impossible de sauvegarder le statut.'};
  session=ns;return {success:true,mob:session.mobs[id]};
}

function retirerStatutMob(id, statutId){
  const mob=session.mobs?.[id];
  if(!mob)return {success:false,message:'Créature introuvable.'};

  const anciens=normaliserStatutsJoueur(mob.statuts);
  if(!anciens.some(s=>s.id===statutId))return {success:false,message:'Ce statut n’est pas appliqué.'};
  const statuts=anciens.filter(s=>s.id!==statutId);

  const ns={...session,mobs:{...session.mobs,[id]:{...mob,statuts,updatedAt:new Date().toISOString()}},lastSaved:new Date().toISOString()};
  if(!ecrireSession(ns))return {success:false,message:'Impossible de retirer le statut.'};
  session=ns;return {success:true,mob:session.mobs[id]};
}


function getPlayerPersonalNotes(id) {
  const joueur=session.players[id];
  return joueur ? normaliserNotesPersonnelles(joueur.personalNotes) : null;
}

function setPlayerPersonalNotes(id, content) {
  const joueur=session.players[id];
  if(!joueur) return {success:false,message:'Joueur introuvable.'};
  if(typeof content!=='string') return {success:false,message:'Contenu invalide.'};
  if(content.length>20000) return {success:false,message:'Les notes personnelles sont limitées à 20000 caractères.'};

  const now=new Date().toISOString();
  const updatedPlayer={...joueur,personalNotes:content,lastSaved:now};
  const nouvelleSession={...session,players:{...session.players,[id]:updatedPlayer},lastSaved:now};
  if(!ecrireSession(nouvelleSession)) return {success:false,message:'Impossible de sauvegarder les notes personnelles.'};
  session=nouvelleSession;
  return {success:true,content};
}

function getPublicNotes() {
  return normaliserNotesPubliques(session.publicNotes);
}

function savePublicNote(note) {
  const title=typeof note?.title==='string'?note.title.trim():'';
  const content=typeof note?.content==='string'?note.content.trim():'';
  if(!title && !content) return {success:false,message:'La note publique est vide.'};
  if(title.length>200) return {success:false,message:'Le titre est trop long.'};
  if(content.length>20000) return {success:false,message:'La note publique est trop longue.'};

  const now=new Date().toISOString();
  const newNote={id:note?.id||crypto.randomUUID(),title,content,createdAt:note?.createdAt||now,updatedAt:now};
  let notes=normaliserNotesPubliques(session.publicNotes);
  if(note?.id){
    if(!notes.some(n=>n.id===note.id)) return {success:false,message:'Note publique introuvable.'};
    notes=notes.map(n=>n.id===note.id?newNote:n);
  } else {
    notes=[...notes,newNote];
  }

  const nouvelleSession={...session,publicNotes:notes,lastSaved:now};
  if(!ecrireSession(nouvelleSession)) return {success:false,message:'Impossible de sauvegarder la note publique.'};
  session=nouvelleSession;
  return {success:true,note:newNote,notes};
}

function deletePublicNote(id) {
  const notes=normaliserNotesPubliques(session.publicNotes);
  if(!notes.some(n=>n.id===id)) return {success:false,message:'Note publique introuvable.'};
  const nouvelleSession={...session,publicNotes:notes.filter(n=>n.id!==id),lastSaved:new Date().toISOString()};
  if(!ecrireSession(nouvelleSession)) return {success:false,message:'Impossible de supprimer la note publique.'};
  session=nouvelleSession;
  return {success:true,notes:nouvelleSession.publicNotes};
}

// ------------------------------------------------------------------
// V1.13 — Carte active de la partie.
//
// La bibliothèque de cartes vit dans maps.json (module map.js).
// La session ne conserve que le pointeur vers la carte utilisée : c'est
// une donnée de partie, exportée/importée avec elle.
// ------------------------------------------------------------------
function getActiveMapId() {
  return session.activeMapId || null;
}

function setActiveMapId(mapId) {
  const valeur = typeof mapId === 'string' && mapId ? mapId : null;
  if (session.activeMapId === valeur) {
    return { success: true, activeMapId: valeur, modifie: false };
  }

  const nouvelleSession = {
    ...session,
    activeMapId: valeur,
    lastSaved: new Date().toISOString()
  };

  if (!ecrireSession(nouvelleSession)) {
    return { success: false, message: "Impossible de sauvegarder la carte active." };
  }

  session = nouvelleSession;
  return { success: true, activeMapId: valeur, modifie: true };
}

function getEcranVue() {
  return normaliserVueEcran(session.ecranVue);
}

function setEcranVue(vue) {
  if (!VUES_ECRAN.includes(vue)) {
    return { success: false, message: "Vue d'écran inconnue." };
  }
  if (session.ecranVue === vue) return { success: true, vue, modifie: false };

  const nouvelleSession = { ...session, ecranVue: vue, lastSaved: new Date().toISOString() };
  if (!ecrireSession(nouvelleSession)) {
    return { success: false, message: "Impossible de sauvegarder la vue de l'écran." };
  }
  session = nouvelleSession;
  return { success: true, vue, modifie: true };
}

function getInitiative() {
  return initiativeModele.normaliserEtat(session.initiative);
}

function setInitiative(etat) {
  const initiative = initiativeModele.normaliserEtat(etat);
  const nouvelleSession = { ...session, initiative, lastSaved: new Date().toISOString() };
  if (!ecrireSession(nouvelleSession)) {
    return { success: false, message: "Impossible de sauvegarder l'initiative." };
  }
  session = nouvelleSession;
  return { success: true, initiative };
}

function getSessionMobs() {
  return session.mobs || {};
}

function getSessionMobById(id) {
  return session.mobs?.[id] || null;
}

function sauvegarderMobSession(mob) {
  if (!mob || !mob.id || !mob.nom) return false;

  const nouvelleSession = {
    ...session,
    mobs: {
      ...(session.mobs || {}),
      [mob.id]: {
        ...mob,
        id: mob.id,
        updatedAt: new Date().toISOString()
      }
    },
    lastSaved: new Date().toISOString()
  };

  if (!ecrireSession(nouvelleSession)) return false;
  session = nouvelleSession;
  return true;
}

function supprimerMobSession(id) {
  if (!session.mobs?.[id]) return false;

  const mobs = { ...session.mobs };
  delete mobs[id];

  const nouvelleSession = {
    ...session,
    mobs,
    lastSaved: new Date().toISOString()
  };

  if (!ecrireSession(nouvelleSession)) return false;
  session = nouvelleSession;
  return true;
}

lireSession();

module.exports = {
  getSession,
  getSessionPlayerById,
  ensureSessionPlayer,
  synchroniserSessionDepuisPersonnage,
  sauvegarderEtatSession,
  getDonneesPersonnageDepuisSession,
  importerSession,
  validerSessionImport,
  STATUTS_JOUEUR,
  getStatutsJoueurDisponibles,
  normaliserStatutsJoueur,
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
  setActiveMapId,
  getEcranVue,
  setEcranVue,
  getInitiative,
  setInitiative,
  getSessionMobs,
  getSessionMobById,
  sauvegarderMobSession,
  supprimerMobSession
};
