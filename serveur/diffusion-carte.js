// serveur/diffusion-carte.js
// ---------------------------------------------------------------------------
// Carte active : entités affichées, projection par rôle, diffusion temps réel.
// ---------------------------------------------------------------------------
const mapStore = require('../map');
const allegement = require('../allegement');
const {
  getJoueurs
} = require('../joueur');
const {
  getSessionPlayerById,
  ensureSessionPlayer,
  getSessionMobs,
  getActiveMapId,
  setActiveMapId
} = require('../session');

let io = null;
/** À appeler une fois au démarrage, avant toute diffusion. */
function attacherIo(instanceIo) {
  io = instanceIo;
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

module.exports = { attacherIo, buildMapEntities, chargerCarteActive, getActiveMapForViewer, emitMapState };
