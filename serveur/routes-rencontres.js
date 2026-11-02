// serveur/routes-rencontres.js
// ---------------------------------------------------------------------------
// Rencontres préparées (V2.4) : gestion (Données de jeu) et déploiement sur
// la carte (carte MJ). Tout est réservé au MJ : une rencontre préparée est
// un secret de la partie.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const express = require('express');
const mapStore = require('../map');
const initiativeModele = require('../initiative');
const {
  getRencontres,
  getRencontreById,
  creerRencontre,
  modifierRencontre,
  supprimerRencontre,
  dupliquerRencontre
} = require('../rencontres');
const { createMobFromTemplate, getMobTemplateById } = require('../mob');
const {
  getSessionMobs,
  sauvegarderMobSession,
  getInitiative,
  setInitiative,
  setMobSceneVisibility,
  setSceneTokensVisibility,
  supprimerMobsSession
} = require('../session');
const { refuserSiPasMj } = require('./acces');
const { emitMapState } = require('./diffusion-carte');

const app = express.Router();
let io = null;

function statutErreur(resultat) {
  return resultat.introuvable ? 404 : 400;
}

app.get('/api/rencontres', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  res.json(getRencontres());
});

app.post('/api/rencontres', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  const resultat = creerRencontre(req.body || {});
  if (!resultat.success) return res.status(400).json({ message: resultat.message });
  io.emit('rencontresUpdated');
  res.status(201).json({ message: 'Rencontre créée.', rencontre: resultat.rencontre });
});

app.put('/api/rencontres/:id', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  const resultat = modifierRencontre(req.params.id, req.body || {});
  if (!resultat.success) return res.status(statutErreur(resultat)).json({ message: resultat.message });
  io.emit('rencontresUpdated');
  res.json({ message: 'Rencontre modifiée.', rencontre: resultat.rencontre });
});

app.delete('/api/rencontres/:id', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  const resultat = supprimerRencontre(req.params.id);
  if (!resultat.success) return res.status(statutErreur(resultat)).json({ message: resultat.message });
  io.emit('rencontresUpdated');
  res.json({ message: 'Rencontre supprimée.' });
});

app.post('/api/rencontres/:id/duplicate', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  const resultat = dupliquerRencontre(req.params.id);
  if (!resultat.success) return res.status(statutErreur(resultat)).json({ message: resultat.message });
  io.emit('rencontresUpdated');
  res.status(201).json({ message: 'Copie créée.', rencontre: resultat.rencontre });
});

/**
 * Déploiement : les créatures de la rencontre sont créées depuis le
 * bestiaire (« Gobelin », « Gobelin #2 »...), placées groupées autour de la
 * case choisie, éventuellement cachées (embuscade), puis :
 *   - combat en cours : insérées dans l'initiative à leur rang ;
 *   - sinon : leur valeur d'initiative est pré-remplie dans la préparation.
 */
app.post('/api/maps/:mapId/rencontres/:id/deployer', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  const rencontre = getRencontreById(req.params.id);
  if (!rencontre) return res.status(404).json({ message: 'Rencontre introuvable.' });
  if (!mapStore.getMapById(req.params.mapId)) return res.status(404).json({ message: 'Carte introuvable.' });

  const cachees = req.body?.cachees === true;
  const existants = { ...getSessionMobs() };
  const crees = [];
  const ignores = [];
  // Chaque créature garde la trace de ce déploiement : la carte MJ et le
  // tableau blanc les regroupent dans une sous-liste nommée comme la rencontre.
  const lien = { id: rencontre.id, nom: rencontre.nom, deploiement: crypto.randomUUID(), le: new Date().toISOString() };

  for (const groupe of rencontre.groupes) {
    if (!getMobTemplateById(groupe.templateId)) { ignores.push(groupe.templateId); continue; }
    for (let i = 0; i < groupe.quantite; i += 1) {
      const mob = createMobFromTemplate(groupe.templateId, { initiative: groupe.initiative, rencontre: lien }, { mobsExistants: existants });
      if (!mob || !sauvegarderMobSession(mob)) {
        return res.status(500).json({ message: 'Impossible de créer les créatures de la rencontre.' });
      }
      existants[mob.id] = mob;
      crees.push({ mob, initiative: groupe.initiative });
    }
  }
  if (!crees.length) {
    return res.status(400).json({ message: 'Aucune créature : les modèles de cette rencontre ne sont plus dans le bestiaire.' });
  }

  const placement = mapStore.placerGroupe(
    req.params.mapId,
    crees.map(({ mob }) => ({ kind: 'mob', entityId: mob.id })),
    { x: req.body?.x, y: req.body?.y },
    { visibleToPlayers: !cachees }
  );

  // Embuscade : cachées aussi sur le tableau blanc.
  if (cachees) crees.forEach(({ mob }) => setMobSceneVisibility(mob.id, false));

  let initiativeAjoutee = false;
  const etat = getInitiative();
  if (etat?.actif) {
    const resultat = initiativeModele.ajouter(etat, crees.map(({ mob, initiative }) => ({
      kind: 'mob', entityId: mob.id, nom: mob.nom, valeur: initiative ?? 0, cache: cachees
    })));
    if (resultat.success && setInitiative(resultat.etat).success) {
      initiativeAjoutee = true;
      io.emit('initiativeUpdated');
    }
  }

  io.emit('mobUpdated', { type: 'rencontre' });
  io.emit('sceneUpdated');
  emitMapState();

  res.status(201).json({
    message: `« ${rencontre.nom} » : ${crees.length} créature(s) déployée(s)`
      + (initiativeAjoutee ? ', ajoutées au combat en cours.' : '.'),
    mobs: crees.map(({ mob }) => ({ id: mob.id, nom: mob.nom })),
    placees: placement.success ? placement.placements.length : 0,
    ignores,
    initiativeAjoutee
  });
});

// ---------------------------------------------------------------------------
// Sous-liste d'une rencontre déployée (carte MJ, tableau blanc) : toutes ses
// créatures cachées ou montrées, ou retirées de la partie, en une fois. La
// rencontre préparée (Données de jeu) n'est jamais touchée.
// ---------------------------------------------------------------------------
function creaturesDuDeploiement(deploiement) {
  return Object.values(getSessionMobs()).filter(mob => mob.rencontre?.deploiement === deploiement);
}

/** Contrôles communs : MJ, booléen `visible`, déploiement connu. */
function preparerVisibilite(req, res) {
  if (refuserSiPasMj(req, res)) return null;
  if (typeof req.body?.visible !== 'boolean') {
    res.status(400).json({ message: 'Visibilité attendue : vrai ou faux.' });
    return null;
  }
  const creatures = creaturesDuDeploiement(req.params.deploiement);
  if (!creatures.length) {
    res.status(404).json({ message: 'Aucune créature de cette rencontre dans la partie.' });
    return null;
  }
  return { visible: req.body.visible, tokenIds: creatures.map(mob => `mob:${mob.id}`) };
}

const messageVisibilite = (visible, nombre) =>
  `${nombre} créature(s) ${visible ? 'montrée(s)' : 'cachée(s)'} aux joueurs et à l'Écran.`;

app.put('/api/maps/:mapId/rencontres/deploiements/:deploiement/visibilite', (req, res) => {
  const demande = preparerVisibilite(req, res);
  if (!demande) return;
  const resultat = mapStore.definirVisibiliteTokens(req.params.mapId, demande.tokenIds, demande.visible);
  if (!resultat.success) return res.status(404).json({ message: resultat.message });
  emitMapState();
  res.json({ message: messageVisibilite(demande.visible, resultat.tokenIds.length), tokenIds: resultat.tokenIds, visible: demande.visible });
});

app.put('/api/session/scene/rencontres/deploiements/:deploiement/visibilite', (req, res) => {
  const demande = preparerVisibilite(req, res);
  if (!demande) return;
  const resultat = setSceneTokensVisibility(demande.tokenIds, demande.visible);
  if (!resultat.success) return res.status(500).json({ message: resultat.message });
  io.emit('sceneUpdated');
  res.json({ message: messageVisibilite(demande.visible, resultat.tokenIds.length), tokenIds: resultat.tokenIds, visible: demande.visible });
});

app.delete('/api/rencontres/deploiements/:deploiement', (req, res) => {
  if (refuserSiPasMj(req, res)) return;
  const creatures = creaturesDuDeploiement(req.params.deploiement);
  if (!creatures.length) return res.status(404).json({ message: 'Aucune créature de cette rencontre dans la partie.' });
  const resultat = supprimerMobsSession(creatures.map(mob => mob.id));
  if (!resultat.success) return res.status(500).json({ message: 'Impossible de retirer les créatures de la partie.' });
  io.emit('mobUpdated', { type: 'deleted', mobIds: creatures.map(mob => mob.id) });
  io.emit('sceneUpdated');
  // Elles ont aussi quitté l'ordre d'initiative.
  io.emit('initiativeUpdated');
  emitMapState();
  res.json({ message: `« ${creatures[0].rencontre.nom} » : ${resultat.nombre} créature(s) retirée(s) de la partie.`, nombre: resultat.nombre });
});

module.exports = instanceIo => {
  io = instanceIo;
  return app;
};
